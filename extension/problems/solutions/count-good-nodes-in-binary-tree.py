class Solution:
    def goodNodes(self, root: TreeNode) -> int:
        def go(node, high):
            if not node:
                return 0
            good = node.val >= high
            high = max(high, node.val)
            return good + go(node.left, high) + go(node.right, high)

        return go(root, root.val)
