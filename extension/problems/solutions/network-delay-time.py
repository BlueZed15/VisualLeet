class Solution:
    def networkDelayTime(self, times: List[List[int]], n: int, k: int) -> int:
        graph = defaultdict(list)
        for u, v, w in times:
            graph[u].append((v, w))
        best, heap = {}, [(0, k)]
        while heap:
            d, u = heappop(heap)
            if u in best:
                continue
            best[u] = d
            for v, w in graph[u]:
                if v not in best:
                    heappush(heap, (d + w, v))
        return max(best.values()) if len(best) == n else -1
