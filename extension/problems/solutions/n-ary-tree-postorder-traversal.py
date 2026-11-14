class Solution:
    def postorder(self, root: 'Node') -> List[int]:
        out = []

        def walk(node):
            if node:
                for c in node.children:
                    walk(c)
                out.append(node.val)

        walk(root)
        return out
