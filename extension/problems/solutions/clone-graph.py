class Solution:
    def cloneGraph(self, node: Optional['Node']) -> Optional['Node']:
        if node is None:
            return None
        copies = {}

        def clone(n):
            if n in copies:
                return copies[n]
            copies[n] = Node(n.val)
            copies[n].neighbors = [clone(x) for x in n.neighbors]
            return copies[n]

        return clone(node)
