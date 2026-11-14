class Codec:
    def serialize(self, root: Optional[TreeNode]) -> str:
        out = []

        def walk(node):
            if node:
                out.append(str(node.val))
                walk(node.left)
                walk(node.right)

        walk(root)
        return ",".join(out)

    def deserialize(self, data: str) -> Optional[TreeNode]:
        values = [int(x) for x in data.split(",") if x]
        i = 0

        def build(lo, hi):
            nonlocal i
            if i == len(values) or not (lo < values[i] < hi):
                return None
            node = TreeNode(values[i])
            i += 1
            node.left = build(lo, node.val)
            node.right = build(node.val, hi)
            return node

        return build(float("-inf"), float("inf"))
