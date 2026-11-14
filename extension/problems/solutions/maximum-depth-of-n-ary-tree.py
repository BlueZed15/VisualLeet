class Solution:
    def maxDepth(self, root: 'Node') -> int:
        if root is None:
            return 0
        return 1 + max((self.maxDepth(c) for c in root.children), default=0)
