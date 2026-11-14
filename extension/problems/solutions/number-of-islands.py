class Solution:
    def numIslands(self, grid: List[List[str]]) -> int:
        rows, cols, count = len(grid), len(grid[0]), 0
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] == "1":
                    count += 1
                    stack = [(r, c)]
                    grid[r][c] = "0"
                    while stack:
                        i, j = stack.pop()
                        for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                            if 0 <= a < rows and 0 <= b < cols and grid[a][b] == "1":
                                grid[a][b] = "0"
                                stack.append((a, b))
        return count
