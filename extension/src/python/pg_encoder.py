# Online Python Tutor
# https://github.com/pgbovine/OnlinePythonTutor/
#
# Copyright (C) Philip Guo (http://pgbovine.net/)
#
# Permission is hereby granted, free of charge, to any person obtaining a
# copy of this software and associated documentation files (the
# "Software"), to deal in the Software without restriction, including
# without limitation the rights to use, copy, modify, merge, publish,
# distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so, subject to
# the following conditions:
#
# The above copyright notice and this permission notice shall be included
# in all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
# OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
# MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
# IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
# CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
# TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
# SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

# Thanks to John DeNero for making the encoder work on both Python 2 and 3
# (circa 2012-2013)

# VisualLeet fork of OnlinePythonTutor-Backup/v5-unity/pg_encoder.py
# (nested repo commit 473848d). Performance changes, output unchanged
# (checked by extension/tests/test_tracer_equivalence.py):
#  - ObjectEncoder reuses the previous step's encoding of a long list/tuple/
#    set/dict whose elements are unchanged (see ObjectEncoder._cache).
#  - encode() skips an inspect.getmodule() probe whose result is always
#    discarded for builtin containers (see _BUILTIN_CONTAINERS).
# Display change: classes no longer show Python 3.13+'s __firstlineno__ and
# __static_attributes__ (interpreter bookkeeping, like __qualname__).


# Given an arbitrary piece of Python data, encode it in such a manner
# that it can be later encoded into JSON.
#   http://json.org/
#
# We use this function to encode run-time traces of data structures
# to send to the front-end.
#
# Format:
#   Primitives:
#   * None, int, long, float, str, bool - unchanged
#     (json.dumps encodes these fine verbatim, except for inf, -inf, and nan)
#
#   exceptions: float('inf')  -> ['SPECIAL_FLOAT', 'Infinity']
#               float('-inf') -> ['SPECIAL_FLOAT', '-Infinity']
#               float('nan')  -> ['SPECIAL_FLOAT', 'NaN']
#               x == int(x)   -> ['SPECIAL_FLOAT', '%.1f' % x]
#               (this way, 3.0 prints as '3.0' and not as 3, which looks like an int)
#
#   If render_heap_primitives is True, then primitive values are rendered
#   on the heap as ['HEAP_PRIMITIVE', <type name>, <value>]
#
#   (for SPECIAL_FLOAT values, <value> is a list like ['SPECIAL_FLOAT', 'Infinity'])
#
#   added on 2018-06-13:
#   ['IMPORTED_FAUX_PRIMITIVE', <label>] - renders externally imported objects
#                                          like they were primitives, to save
#                                          space and to prevent from having to
#                                          recurse into of them to see internals
#
#   Compound objects:
#   * list     - ['LIST', elt1, elt2, elt3, ..., eltN]
#   * tuple    - ['TUPLE', elt1, elt2, elt3, ..., eltN]
#   * set      - ['SET', elt1, elt2, elt3, ..., eltN]
#   * dict     - ['DICT', [key1, value1], [key2, value2], ..., [keyN, valueN]]
#   * instance - ['INSTANCE', class name, [attr1, value1], [attr2, value2], ..., [attrN, valueN]]
#   * instance with non-trivial __str__ defined - ['INSTANCE_PPRINT', class name, <__str__ value>, [attr1, value1], [attr2, value2], ..., [attrN, valueN]]
#   * class    - ['CLASS', class name, [list of superclass names], [attr1, value1], [attr2, value2], ..., [attrN, valueN]]
#   * function - ['FUNCTION', function name, parent frame ID (for nested functions),
#                 [*OPTIONAL* list of pairs of default argument names/values] ] <-- final optional element added on 2018-06-13
#   * module   - ['module', module name]
#   * other    - [<type name>, string representation of object]
#   * compound object reference - ['REF', target object's unique_id]
#
# the unique_id is derived from id(), which allows us to capture aliasing


# number of significant digits for floats
FLOAT_PRECISION = 4


from collections import defaultdict
from itertools import chain
from operator import is_
import re, types
import sys
import math
typeRE = re.compile("<type '(.*)'>")
classRE = re.compile("<class '(.*)'>")

import inspect

# TODO: maybe use the 'six' library to smooth over Py2 and Py3 incompatibilities?
is_python3 = (sys.version_info[0] == 3)
if is_python3:
  # avoid name errors (GROSS!)
  long = int
  unicode = str


def is_class(dat):
  """Return whether dat is a class."""
  if is_python3:
    return isinstance(dat, type)
  else:
    return type(dat) in (types.ClassType, types.TypeType)


def is_instance(dat):
  """Return whether dat is an instance of a class."""
  if is_python3:
    return type(dat) not in PRIMITIVE_TYPES and \
           isinstance(type(dat), type) and \
           not isinstance(dat, type)
  else:
    # ugh, classRE match is a bit of a hack :(
    return type(dat) == types.InstanceType or classRE.match(str(type(dat)))


def _tidy_ident(s):
  # labels are inserted into the page as HTML: keep identifier characters only
  return re.sub(r'[^\w.]', '', str(s)) or 'object'

def _tidy_label(dat, typing_only=False):
  """VisualLeet tidy mode: a short label for typing names, functions and classes, else None."""
  try:
    if getattr(type(dat), '__module__', '') == 'typing' or (is_class(dat) and getattr(dat, '__module__', '') == 'typing'):
      return 'typing.' + _tidy_ident(getattr(dat, '_name', None) or getattr(dat, '__name__', None) or 'alias')
    if typing_only:
      return None
    if type(dat) in (types.FunctionType, types.MethodType, types.BuiltinFunctionType, types.BuiltinMethodType):
      return _tidy_ident(get_name(dat)) + '()'
    if is_class(dat):
      return 'class ' + _tidy_ident(get_name(dat))
  except Exception:
    pass
  return None

def get_name(obj):
  """Return the name of an object."""
  return obj.__name__ if hasattr(obj, '__name__') else get_name(type(obj))


PRIMITIVE_TYPES = (int, long, float, str, unicode, bool, type(None))

# VisualLeet: reuse unchanged encodings across steps (see ObjectEncoder._cache).
ENABLE_ENCODE_CACHE = True
# Only containers at least this long are cached: below it, checking the cache
# costs about as much as encoding (measured on the bench fixtures).
CACHE_MIN_ELEMENTS = 16

# Exact builtin container types. For these, the inspect.getmodule() probe in
# encode() can never mark the object as externally defined (it fails with an
# exception that encode() catches, and the instance override below it resets
# the flag anyway), and it cannot run user code, so VisualLeet skips it:
# about 2 us per container per step.
_BUILTIN_CONTAINERS = (list, tuple, dict, set)
_PRIMITIVE_TYPE_SET = frozenset(PRIMITIVE_TYPES)

_EXCLUDED_DICT_KEYS = ('__module__', '__return__', '__locals__')


def _get_path(obj, path):
  for i in path:
    obj = obj[i]
  return obj


def _set_path(obj, path, value):
  """Copy of obj with obj[path] = value (copies only along the path)."""
  copy = list(obj)
  if len(path) == 1:
    copy[path[0]] = value
  else:
    copy[path[0]] = _set_path(obj[path[0]], path[1:], value)
  return copy


def encode_primitive(dat):
  t = type(dat)
  if t is float:
    if math.isinf(dat):
      if dat > 0:
        return ['SPECIAL_FLOAT', 'Infinity']
      else:
        return ['SPECIAL_FLOAT', '-Infinity']
    elif math.isnan(dat):
      return ['SPECIAL_FLOAT', 'NaN']
    else:
      # render floats like 3.0 as '3.0' and not as 3
      if dat == int(dat):
        return ['SPECIAL_FLOAT', '%.1f' % dat]
      else:
        return round(dat, FLOAT_PRECISION)
  elif t is str and (not is_python3):
    # hack only for Python 2 strings ... always turn into unicode
    # and display '?' when it's not valid unicode
    return dat.decode('utf-8', 'replace')
  else:
    # return all other primitives verbatim
    return dat


# grab a line number like ' <line 2>' or ' <line 2b>'
def create_lambda_line_number(codeobj, line_to_lambda_code):
  try:
    lambda_lineno = codeobj.co_firstlineno
    lst = line_to_lambda_code[lambda_lineno]
    ind = lst.index(codeobj)
    # add a suffix for all subsequent lambdas on a line beyond the first
    # (nix this for now because order isn't guaranteed when you have
    #  multiple lambdas on the same line)
    '''
    if ind > 0:
      lineno_str = str(lambda_lineno) + chr(ord('a') + ind)
    else:
      lineno_str = str(lambda_lineno)
    '''
    lineno_str = str(lambda_lineno)
    return ' <line ' + lineno_str + '>'
  except:
    return ''


# Note that this might BLOAT MEMORY CONSUMPTION since we're holding on
# to every reference ever created by the program without ever releasing
# anything!
class ObjectEncoder:
  def __init__(self, parent):
    self.parent = parent # should be a PGLogger object

    # Key: canonicalized small ID
    # Value: encoded (compound) heap object
    self.encoded_heap_objects = {}

    self.render_heap_primitives = parent.render_heap_primitives

    self.id_to_small_IDs = {}
    self.cur_small_ID = 1

    # wow, creating unique identifiers for lambdas is quite annoying,
    # especially if we want to properly differentiate:
    # 1.) multiple lambdas defined on the same line, and
    # 2.) the same lambda code defined multiple times on different lines
    #
    # However, it gets confused when there are multiple identical
    # lambdas on the same line, like:
    # f(lambda x:x*x, lambda y:y*y, lambda x:x*x)

    # (assumes everything is in one file)
    # Key:   line number
    # Value: list of the code objects of lambdas defined
    #        on that line in the order they were defined
    self.line_to_lambda_code = defaultdict(list)

    # VisualLeet encode cache: reuse the previous step's encoding of an object
    # whose contents did not change.
    # Key:   small ID
    # Value: (type, element ids, element types, primitive elements,
    #         encoded heap entry, children)
    #   ids/types are None when every element is primitive; then the kept
    #   primitive elements are compared by identity instead.
    # Only exact list/tuple/set/dict with >= CACHE_MIN_ELEMENTS elements.
    # "Elements" are the objects encoding visits, in order (items; for dicts,
    # keys and values). A hit requires the
    # same type and, element by element, the same id() and type(). The cache
    # holds no reference to the object or its compound elements, so object
    # lifetimes, finalizers and id() reuse in the user's program are untouched.
    # It does keep primitive elements alive (immutable, no finalizers), so an
    # equal id+type for a primitive slot means the very same value.
    # Compound elements encode as ['REF', small ID], a function of id() alone;
    # on a hit they are still encoded (so their own changes are picked up and
    # they enter this step's heap in the same order a fresh encoding adds
    # them), and each result is checked against the stored entry.
    self._cache = {}

  def should_hide_var(self, var):
    return self.parent.should_hide_var(var)

  # searches through self.parents.types_to_inline and tries
  # to match the type returned by type(obj).__name__ and
  # also 'class' and 'instance' for classes and instances, respectively
  def should_inline_object_by_type(self, obj):
    # fast-pass optimization -- common case
    if not self.parent.types_to_inline:
      return False

    # copy-pasted from the end of self.encode()
    typ = type(obj)
    typename = typ.__name__

    # pick up built-in functions too:
    if typ in (types.FunctionType, types.MethodType, types.BuiltinFunctionType, types.BuiltinMethodType):
        typename = 'function'

    if not typename:
        return False

    alt_typename = None
    if is_class(obj):
        alt_typename = 'class'
    elif is_instance(obj) and typename != 'function':
        # if obj is an instance of the Fooo class, then we want to match
        # on both 'instance' and 'Fooo'
        # (exception: 'function' objects are sometimes also instances,
        #  but we still want to call them 'function', so ignore them)
        typename = 'instance'
        class_name = None
        if hasattr(obj, '__class__'):
            # common case ...
            class_name = get_name(obj.__class__)
        else:
            # super special case for something like
            # "from datetime import datetime_CAPI" in Python 3.2,
            # which is some weird 'PyCapsule' type ...
            # http://docs.python.org/release/3.1.5/c-api/capsule.html
            class_name = get_name(type(obj))
        alt_typename = class_name

    for re_match in self.parent.types_to_inline:
        if re_match(typename):
            return True
        if alt_typename and re_match(alt_typename):
            return True
    return False


  def get_heap(self):
    return self.encoded_heap_objects


  def reset_heap(self):
    # VERY IMPORTANT to reassign to an empty dict rather than just
    # clearing the existing dict, since get_heap() could have been
    # called earlier to return a reference to a previous heap state
    if self._cache:
      prev_heap = self.encoded_heap_objects
      self._cache = {k: v for k, v in self._cache.items() if k in prev_heap}
    self.encoded_heap_objects = {}

  @staticmethod
  def _elements(typ, dat):
    """Objects that encoding dat visits, in visiting order (None: don't cache)."""
    if typ is list or typ is set or typ is tuple:
      return tuple(dat)
    if typ is dict:
      return tuple(chain.from_iterable(dat.items()))
    return None

  def _try_cached(self, my_small_id, dat, get_parent):
    entry = self._cache.get(my_small_id)
    if entry is None:
      return False
    typ = type(dat)
    if typ is not entry[0]:
      return False
    elems = self._elements(typ, dat)
    if elems is None:
      return False
    if entry[1] is None:
      # all-primitive container: the cache keeps those very objects alive, so
      # identity element by element means identical values (one C-level pass)
      old = entry[3]
      if len(elems) != len(old) or not all(map(is_, elems, old)):
        return False
    elif tuple(map(id, elems)) != entry[1] or tuple(map(type, elems)) != entry[2]:
      return False
    new_obj = entry[4]
    self.encoded_heap_objects[my_small_id] = new_obj
    for (idx, path) in entry[5]:
      r = self.encode(elems[idx], get_parent)
      if r != _get_path(new_obj, path):
        # a different object reused a dead element's id and encodes differently
        # (e.g. imported vs user-defined): patch a copy, never the shared entry
        new_obj = _set_path(new_obj, path, r)
        self.encoded_heap_objects[my_small_id] = new_obj
    if new_obj is not entry[4]:
      self._cache[my_small_id] = entry[:4] + (new_obj,) + entry[5:]
    return True

  def _cache_plan(self, dat):
    """Before encoding dat: (type, elements, children) or None if not cacheable.

    children: (index into elements, path into the encoded entry) for each
    compound element, in the order a fresh encoding visits them.
    """
    typ = type(dat)
    elems = self._elements(typ, dat)
    if elems is None or len(elems) < CACHE_MIN_ELEMENTS:
      return None
    if _PRIMITIVE_TYPE_SET.issuperset(map(type, elems)):
      return (typ, elems, ())  # all primitive: no children (C-level check)
    children = []
    if typ is list or typ is set or typ is tuple:
      for i, e in enumerate(elems):
        if type(e) not in PRIMITIVE_TYPES:
          children.append((i, (i + 1,)))
    elif typ is dict:
      pair = 0
      for j in range(0, len(elems), 2):
        k, v = elems[j], elems[j + 1]
        kt = type(k)
        # only primitive/tuple keys: comparing other keys with the excluded
        # names would call a user-defined __eq__ an extra time
        if kt not in PRIMITIVE_TYPES and kt is not tuple:
          return None
        if k in _EXCLUDED_DICT_KEYS:
          continue
        if kt not in PRIMITIVE_TYPES:
          children.append((j, (pair + 1, 0)))
        if type(v) not in PRIMITIVE_TYPES:
          children.append((j + 1, (pair + 1, 1)))
        pair += 1
    return (typ, elems, tuple(children))

  def _remember(self, my_small_id, dat, new_obj, plan):
    """After encoding: store the entry, unless dat changed while being encoded."""
    typ, elems, children = plan
    expected_tag = {list: 'LIST', tuple: 'TUPLE', set: 'SET', dict: 'DICT'}[typ]
    if not new_obj or new_obj[0] != expected_tag:
      return
    after = self._elements(typ, dat)
    if after is None or len(after) != len(elems) or not all(map(is_, after, elems)):
      return
    if children:
      ids, types_ = tuple(map(id, elems)), tuple(map(type, elems))
      prims = tuple([e for e in elems if type(e) in PRIMITIVE_TYPES])
    else:
      ids = types_ = None  # all primitive: compared by identity, see _try_cached
      prims = elems
    self._cache[my_small_id] = (typ, ids, types_, prims, new_obj, children)

  def set_function_parent_frame_ID(self, ref_obj, enclosing_frame_id):
    assert ref_obj[0] == 'REF'
    func_obj = self.encoded_heap_objects[ref_obj[1]]
    assert func_obj[0] == 'FUNCTION'
    func_obj[-1] = enclosing_frame_id


  # return either a primitive object or an object reference;
  # and as a side effect, update encoded_heap_objects
  def encode(self, dat, get_parent):
    """Encode a data value DAT using the GET_PARENT function for parent ids."""
    # primitive type
    if not self.render_heap_primitives and type(dat) in PRIMITIVE_TYPES:
      return encode_primitive(dat)
    # compound type - return an object reference and update encoded_heap_objects
    else:
      # IMPORTED_FAUX_PRIMITIVE feature added on 2018-06-13:
      is_externally_defined = False # is dat defined in external (i.e., non-user) code?
      try:
        if type(dat) in _BUILTIN_CONTAINERS:  # VisualLeet: see _BUILTIN_CONTAINERS
          raise TypeError
        # some objects don't return anything for getsourcefile() but DO return
        # something legit for getmodule(). e.g., "from io import StringIO"
        # so TRY getmodule *first* and then fall back on getsourcefile
        # since getmodule seems more robust empirically ...
        gsf = inspect.getmodule(dat).__file__
        if not gsf:
            gsf = inspect.getsourcefile(dat)

        # a hacky heuristic is that if gsf is an absolute path, then it's likely
        # to be some library function and *not* in user-defined code
        #
        # NB: don't use os.path.isabs() since it doesn't work on some
        # python installations (e.g., on my webserver) and also adds a
        # dependency on the os module. just do a simple check:
        #
        # hacky: do other checks for strings that are indicative of files
        # that load user-written code, like 'generate_json_trace.py'
        if gsf and gsf[0] == '/' and 'generate_json_trace.py' not in gsf:
            is_externally_defined = True
      except (AttributeError, TypeError):
        pass # fail soft
      my_id = id(dat)

      # if dat is an *real* object instance (and not some special built-in one
      # like ABCMeta, or a py3 function object), then DON'T treat it as
      # externally-defined because a user might be instantiating an *instance*
      # of an imported class in their own code, so we want to show that instance
      # in da visualization - ugh #hacky
      if (is_instance(dat) and
          type(dat) not in (types.FunctionType, types.MethodType, types.BuiltinFunctionType, types.BuiltinMethodType) and
          hasattr(dat, '__class__') and (get_name(dat.__class__) != 'ABCMeta')):
        is_externally_defined = False

      # VisualLeet tidy mode (opt-in, options["tidy"]): draw typing names,
      # functions and classes as short inline labels instead of heap boxes,
      # so the view shows the data structures. typing aliases (List, Optional)
      # are *instances*, which the imported-object check above lets through,
      # so they would otherwise be drawn with all their internals.
      if getattr(self.parent, 'tidy', False):
        label = _tidy_label(dat)
        if label:
          return ['IMPORTED_FAUX_PRIMITIVE', label]

      # if this is an externally-defined object (i.e., from an imported
      # module, don't try to recurse into it since we don't want to see
      # the internals of imported objects; just return an
      # IMPORTED_FAUX_PRIMITIVE object and continue along on our way
      if is_externally_defined:
        label = 'object'
        try:
            label = type(dat).__name__
            if is_class(dat):
                label = 'class'
            elif is_instance(dat):
                label = 'object'
        except:
            pass
        return ['IMPORTED_FAUX_PRIMITIVE', 'imported ' + label] # punt early!

      # next check whether it should be inlined
      if self.should_inline_object_by_type(dat):
        label = 'object'
        try:
            label = type(dat).__name__
            if is_class(dat):
                class_name = get_name(dat)
                label = class_name + ' class'
            elif is_instance(dat):
                # a lot of copy-pasta from other parts of this file:
                # TODO: clean up
                class_name = None
                if hasattr(dat, '__class__'):
                    # common case ...
                    class_name = get_name(dat.__class__)
                else:
                    # super special case for something like
                    # "from datetime import datetime_CAPI" in Python 3.2,
                    # which is some weird 'PyCapsule' type ...
                    # http://docs.python.org/release/3.1.5/c-api/capsule.html
                    class_name = get_name(type(dat))
                if class_name:
                    label = class_name + ' instance'
                else:
                    label = 'instance'
        except:
            pass
        return ['IMPORTED_FAUX_PRIMITIVE', label + ' (hidden)'] # punt early!

      try:
        my_small_id = self.id_to_small_IDs[my_id]
      except KeyError:
        my_small_id = self.cur_small_ID
        self.id_to_small_IDs[my_id] = self.cur_small_ID
        self.cur_small_ID += 1

      del my_id # to prevent bugs later in this function

      ret = ['REF', my_small_id]

      # punt early if you've already encoded this object
      if my_small_id in self.encoded_heap_objects:
        return ret

      # VisualLeet: reuse last step's encoding if nothing in dat changed
      use_cache = ENABLE_ENCODE_CACHE and not self.render_heap_primitives
      if use_cache and self._try_cached(my_small_id, dat, get_parent):
        return ret
      cache_plan = self._cache_plan(dat) if use_cache else None

      # major side-effect!
      new_obj = []
      self.encoded_heap_objects[my_small_id] = new_obj

      typ = type(dat)

      if typ == list:
        new_obj.append('LIST')
        for e in dat:
          new_obj.append(self.encode(e, get_parent))
      elif typ == tuple:
        new_obj.append('TUPLE')
        for e in dat:
          new_obj.append(self.encode(e, get_parent))
      elif typ == set:
        new_obj.append('SET')
        for e in dat:
          new_obj.append(self.encode(e, get_parent))
      elif typ == dict:
        new_obj.append('DICT')
        for (k, v) in dat.items():
          # don't display some built-in locals ...
          if k not in ('__module__', '__return__', '__locals__'):
            new_obj.append([self.encode(k, get_parent), self.encode(v, get_parent)])
      elif typ in (types.FunctionType, types.MethodType):
        if is_python3:
          argspec = inspect.getfullargspec(dat)
        else:
          argspec = inspect.getargspec(dat)

        printed_args = [e for e in argspec.args]

        default_arg_names_and_vals = []
        if argspec.defaults:
            num_missing_defaults = len(printed_args) - len(argspec.defaults)
            assert num_missing_defaults >= 0
            # tricky tricky tricky how default positional arguments work!
            for i in range(num_missing_defaults, len(printed_args)):
                default_arg_names_and_vals.append((printed_args[i], self.encode(argspec.defaults[i-num_missing_defaults], get_parent)))

        if argspec.varargs:
          printed_args.append('*' + argspec.varargs)

        if is_python3:
          # kwonlyargs come before varkw
          if argspec.kwonlyargs:
            printed_args.extend(argspec.kwonlyargs)
            if argspec.kwonlydefaults:
              # iterate in order of appearance in kwonlyargs
              for varname in argspec.kwonlyargs:
                if varname in argspec.kwonlydefaults:
                  val = argspec.kwonlydefaults[varname]
                  default_arg_names_and_vals.append((varname, self.encode(val, get_parent)))
          if argspec.varkw:
            printed_args.append('**' + argspec.varkw)
        else:
          if argspec.keywords:
            printed_args.append('**' + argspec.keywords)

        func_name = get_name(dat)

        pretty_name = func_name

        # sometimes might fail for, say, <genexpr>, so just ignore
        # failures for now ...
        try:
          pretty_name += '(' + ', '.join(printed_args) + ')'
        except TypeError:
          pass

        # put a line number suffix on lambdas to more uniquely identify
        # them, since they don't have names
        if func_name == '<lambda>':
            cod = (dat.__code__ if is_python3 else dat.func_code) # ugh!
            lst = self.line_to_lambda_code[cod.co_firstlineno]
            if cod not in lst:
                lst.append(cod)
            pretty_name += create_lambda_line_number(cod,
                                                     self.line_to_lambda_code)

        encoded_val = ['FUNCTION', pretty_name, None]
        if get_parent:
          enclosing_frame_id = get_parent(dat)
          encoded_val[2] = enclosing_frame_id
        new_obj.extend(encoded_val)
        # OPTIONAL!!!
        if default_arg_names_and_vals:
            new_obj.append(default_arg_names_and_vals) # *append* it as a single list element

      elif typ is types.BuiltinFunctionType:
        pretty_name = get_name(dat) + '(...)'
        new_obj.extend(['FUNCTION', pretty_name, None])
      elif is_class(dat) or is_instance(dat):
        self.encode_class_or_instance(dat, new_obj)
      elif typ is types.ModuleType:
        new_obj.extend(['module', dat.__name__])
      elif typ in PRIMITIVE_TYPES:
        assert self.render_heap_primitives
        new_obj.extend(['HEAP_PRIMITIVE', type(dat).__name__, encode_primitive(dat)])
      else:
        typeStr = str(typ)
        m = typeRE.match(typeStr)

        if not m:
          m = classRE.match(typeStr)

        assert m, typ

        if is_python3:
          encoded_dat = str(dat)
        else:
          # ugh, for bytearray() in Python 2, str() returns
          # non-JSON-serializable characters, so need to decode:
          encoded_dat = str(dat).decode('utf-8', 'replace')
        new_obj.extend([m.group(1), encoded_dat])

      if cache_plan is not None:
        self._remember(my_small_id, dat, new_obj, cache_plan)
      return ret


  def encode_class_or_instance(self, dat, new_obj):
    """Encode dat as a class or instance."""
    if is_instance(dat):
      if hasattr(dat, '__class__'):
        # common case ...
        class_name = get_name(dat.__class__)
      else:
        # super special case for something like
        # "from datetime import datetime_CAPI" in Python 3.2,
        # which is some weird 'PyCapsule' type ...
        # http://docs.python.org/release/3.1.5/c-api/capsule.html
        class_name = get_name(type(dat))

      pprint_str = None
      # do you or any of your superclasses have a __str__ field? if so, pretty-print yourself!
      if hasattr(dat, '__str__'):
        try:
          pprint_str = dat.__str__()

          # sometimes you'll get 'trivial' pprint_str like: '<__main__.MyObj object at 0x10f465cd0>'
          # or '<module 'collections' ...'
          # IGNORE THOSE!!!
          if pprint_str[0] == '<' and pprint_str[-1] == '>' and (' at ' in pprint_str or pprint_str.startswith('<module')):
            pprint_str = None
        except:
          pass

      # TODO: filter for trivial-looking pprint_str like those produced
      # by object.__str__
      if pprint_str:
        new_obj.extend(['INSTANCE_PPRINT', class_name, pprint_str])
      else:
        new_obj.extend(['INSTANCE', class_name])

      # don't traverse inside modules, or else risk EXPLODING the visualization
      if class_name == 'module':
        return
    else:
      superclass_names = [e.__name__ for e in dat.__bases__ if e is not object]
      new_obj.extend(['CLASS', get_name(dat), superclass_names])

    # traverse inside of its __dict__ to grab attributes
    # (filter out useless-seeming ones, based on anecdotal observation):
    hidden = ('__doc__', '__module__', '__return__', '__dict__',
        '__locals__', '__weakref__', '__qualname__',
        # VisualLeet: class bookkeeping added in Python 3.13
        '__firstlineno__', '__static_attributes__')
    if hasattr(dat, '__dict__'):
      user_attrs = sorted([e for e in dat.__dict__ if e not in hidden])
    else:
      user_attrs = []

    for attr in user_attrs:
      if not self.should_hide_var(attr):
        new_obj.append([self.encode(attr, None), self.encode(dat.__dict__[attr], None)])

