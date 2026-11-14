class Solution:
    def preorder(self, root: 'Node') -> List[int]:
        out, stack = [], [root] if root else []
        while stack:
            node = stack.pop()
            out.append(node.val)
            stack.extend(reversed(node.children))
        return out
