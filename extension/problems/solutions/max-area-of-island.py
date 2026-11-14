class Solution:
    def maxAreaOfIsland(self, grid: List[List[int]]) -> int:
        rows, cols, best = len(grid), len(grid[0]), 0
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] == 1:
                    grid[r][c], area, stack = 0, 0, [(r, c)]
                    while stack:
                        i, j = stack.pop()
                        area += 1
                        for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                            if 0 <= a < rows and 0 <= b < cols and grid[a][b] == 1:
                                grid[a][b] = 0
                                stack.append((a, b))
                    best = max(best, area)
        return best
