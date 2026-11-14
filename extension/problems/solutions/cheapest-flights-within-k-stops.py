class Solution:
    def findCheapestPrice(self, n: int, flights: List[List[int]], src: int, dst: int, k: int) -> int:
        cost = [float("inf")] * n
        cost[src] = 0
        for _ in range(k + 1):
            nxt = cost[:]
            for a, b, p in flights:
                if cost[a] + p < nxt[b]:
                    nxt[b] = cost[a] + p
            cost = nxt
        return -1 if cost[dst] == float("inf") else cost[dst]
