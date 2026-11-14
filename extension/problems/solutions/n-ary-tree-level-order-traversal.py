class Solution:
    def levelOrder(self, root: 'Node') -> List[List[int]]:
        out, level = [], [root] if root else []
        while level:
            out.append([n.val for n in level])
            level = [c for n in level for c in n.children]
        return out
