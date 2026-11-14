class Solution:
    def swimInWater(self, grid: List[List[int]]) -> int:
        n = len(grid)
        heap, seen = [(grid[0][0], 0, 0)], {(0, 0)}
        while heap:
            t, r, c = heappop(heap)
            if (r, c) == (n - 1, n - 1):
                return t
            for a, b in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= a < n and 0 <= b < n and (a, b) not in seen:
                    seen.add((a, b))
                    heappush(heap, (max(t, grid[a][b]), a, b))
