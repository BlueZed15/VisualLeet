class Solution:
    def distanceK(self, root: TreeNode, target: TreeNode, k: int) -> List[int]:
        parent = {root: None}
        stack = [root]
        while stack:
            n = stack.pop()
            for c in (n.left, n.right):
                if c:
                    parent[c] = n
                    stack.append(c)
        seen, level = {target}, [target]
        for _ in range(k):
            nxt = []
            for n in level:
                for m in (n.left, n.right, parent[n]):
                    if m and m not in seen:
                        seen.add(m)
                        nxt.append(m)
            level = nxt
        return [n.val for n in level]
