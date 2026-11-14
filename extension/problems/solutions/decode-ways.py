class Solution:
    def numDecodings(self, s: str) -> int:
        a, b = 1, 0          # ways for s[:i], s[:i-1]
        prev = ""
        for c in s:
            cur = a if c != "0" else 0
            if prev and 10 <= int(prev + c) <= 26:
                cur += b
            a, b, prev = cur, a, c
        return a
