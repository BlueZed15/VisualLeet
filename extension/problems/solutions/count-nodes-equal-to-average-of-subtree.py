class Solution:
    def averageOfSubtree(self, root: TreeNode) -> int:
        count = 0

        def walk(node):
            nonlocal count
            if node is None:
                return 0, 0
            ls, ln = walk(node.left)
            rs, rn = walk(node.right)
            s, n = ls + rs + node.val, ln + rn + 1
            if s // n == node.val:
                count += 1
            return s, n

        walk(root)
        return count
