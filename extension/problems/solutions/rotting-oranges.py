class Solution:
    def orangesRotting(self, grid: List[List[int]]) -> int:
        rows, cols = len(grid), len(grid[0])
        queue = deque((r, c) for r in range(rows) for c in range(cols) if grid[r][c] == 2)
        fresh = sum(row.count(1) for row in grid)
        minutes = 0
        while queue and fresh:
            for _ in range(len(queue)):
                r, c = queue.popleft()
                for a, b in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= a < rows and 0 <= b < cols and grid[a][b] == 1:
                        grid[a][b] = 2
                        fresh -= 1
                        queue.append((a, b))
            minutes += 1
        return -1 if fresh else minutes
