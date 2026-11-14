class Solution:
    def isMatch(self, s: str, p: str) -> bool:
        @cache
        def go(i, j):
            if j == len(p):
                return i == len(s)
            first = i < len(s) and p[j] in (s[i], ".")
            if j + 1 < len(p) and p[j + 1] == "*":
                return go(i, j + 2) or (first and go(i + 1, j))
            return first and go(i + 1, j + 1)

        return go(0, 0)
