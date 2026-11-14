class Codec:
    def serialize(self, root):
        out = []

        def walk(node):
            if node is None:
                out.append("#")
                return
            out.append(str(node.val))
            walk(node.left)
            walk(node.right)

        walk(root)
        return ",".join(out)

    def deserialize(self, data):
        values = iter(data.split(","))

        def build():
            v = next(values)
            if v == "#":
                return None
            node = TreeNode(int(v))
            node.left = build()
            node.right = build()
            return node

        return build()
