class Solution:
    def findOrder(self, numCourses: int, prerequisites: List[List[int]]) -> List[int]:
        graph, indeg = defaultdict(list), [0] * numCourses
        for a, b in prerequisites:
            graph[b].append(a)
            indeg[a] += 1
        queue = deque(i for i in range(numCourses) if indeg[i] == 0)
        order = []
        while queue:
            x = queue.popleft()
            order.append(x)
            for y in graph[x]:
                indeg[y] -= 1
                if indeg[y] == 0:
                    queue.append(y)
        return order if len(order) == numCourses else []
