class Solution:
    def solve(self, board: List[List[str]]) -> None:
        rows, cols = len(board), len(board[0])
        stack = [(r, c) for r in range(rows) for c in (0, cols - 1)] + [(r, c) for r in (0, rows - 1) for c in range(cols)]
        while stack:
            r, c = stack.pop()
            if 0 <= r < rows and 0 <= c < cols and board[r][c] == "O":
                board[r][c] = "S"
                stack += [(r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)]
        for r in range(rows):
            for c in range(cols):
                board[r][c] = "O" if board[r][c] == "S" else "X"
