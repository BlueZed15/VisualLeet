class Solution:
    def delNodes(self, root: Optional[TreeNode], to_delete: List[int]) -> List[TreeNode]:
        gone, out = set(to_delete), []

        def walk(node, is_root):
            if node is None:
                return None
            deleted = node.val in gone
            if is_root and not deleted:
                out.append(node)
            node.left = walk(node.left, deleted)
            node.right = walk(node.right, deleted)
            return None if deleted else node

        walk(root, True)
        return out
