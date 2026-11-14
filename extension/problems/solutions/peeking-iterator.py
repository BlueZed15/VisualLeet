class PeekingIterator:
    def __init__(self, iterator):
        self.it = iterator
        self.buf = self.it.next() if self.it.hasNext() else None
        self.has = self.buf is not None

    def peek(self):
        return self.buf

    def next(self):
        v = self.buf
        self.has = self.it.hasNext()
        self.buf = self.it.next() if self.has else None
        return v

    def hasNext(self):
        return self.has
