class Solution:
    def canFinish(self, numCourses: int, prerequisites: List[List[int]]) -> bool:
        return len(Solution._order(numCourses, prerequisites)) == numCourses

    @staticmethod
    def _order(n, prereqs):
        graph, indeg = defaultdict(list), [0] * n
        for a, b in prereqs:
            graph[b].append(a)
            indeg[a] += 1
        queue = deque(i for i in range(n) if indeg[i] == 0)
        order = []
        while queue:
            x = queue.popleft()
            order.append(x)
            for y in graph[x]:
                indeg[y] -= 1
                if indeg[y] == 0:
                    queue.append(y)
        return order
