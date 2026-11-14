class Solution:
    def construct(self, grid: List[List[int]]) -> 'Node':
        def build(r, c, size):
            first = grid[r][c]
            if all(grid[i][j] == first for i in range(r, r + size) for j in range(c, c + size)):
                return Node(first == 1, True, None, None, None, None)
            h = size // 2
            return Node(True, False, build(r, c, h), build(r, c + h, h), build(r + h, c, h), build(r + h, c + h, h))

        return build(0, 0, len(grid))
