class Solution:
    def rightSideView(self, root: Optional[TreeNode]) -> List[int]:
        out, level = [], [root] if root else []
        while level:
            out.append(level[-1].val)
            level = [c for n in level for c in (n.left, n.right) if c]
        return out
