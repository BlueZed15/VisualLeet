class Solution:
    def minCostConnectPoints(self, points: List[List[int]]) -> int:
        n = len(points)
        dist = [float("inf")] * n
        used = [False] * n
        dist[0], total = 0, 0
        for _ in range(n):
            i = min((d, j) for j, d in enumerate(dist) if not used[j])[1]
            used[i] = True
            total += dist[i]
            for j in range(n):
                if not used[j]:
                    d = abs(points[i][0] - points[j][0]) + abs(points[i][1] - points[j][1])
                    if d < dist[j]:
                        dist[j] = d
        return total
