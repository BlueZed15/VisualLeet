class Solution:
    def solveNQueens(self, n: int) -> List[List[str]]:
        out, cols = [], []

        def go(r):
            if r == n:
                out.append(["." * c + "Q" + "." * (n - c - 1) for c in cols])
                return
            for c in range(n):
                if all(c != cc and abs(c - cc) != r - rr for rr, cc in enumerate(cols)):
                    cols.append(c)
                    go(r + 1)
                    cols.pop()

        go(0)
        return out
