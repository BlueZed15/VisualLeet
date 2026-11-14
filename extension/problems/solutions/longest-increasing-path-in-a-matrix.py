class Solution:
    def longestIncreasingPath(self, matrix: List[List[int]]) -> int:
        rows, cols = len(matrix), len(matrix[0])

        @cache
        def go(r, c):
            best = 1
            for a, b in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= a < rows and 0 <= b < cols and matrix[a][b] > matrix[r][c]:
                    best = max(best, 1 + go(a, b))
            return best

        return max(go(r, c) for r in range(rows) for c in range(cols))
