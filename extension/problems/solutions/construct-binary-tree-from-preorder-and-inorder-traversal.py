class Solution:
    def buildTree(self, preorder: List[int], inorder: List[int]) -> Optional[TreeNode]:
        where = {v: i for i, v in enumerate(inorder)}
        it = iter(preorder)

        def build(lo, hi):
            if lo > hi:
                return None
            v = next(it)
            node = TreeNode(v)
            node.left = build(lo, where[v] - 1)
            node.right = build(where[v] + 1, hi)
            return node

        return build(0, len(inorder) - 1)
