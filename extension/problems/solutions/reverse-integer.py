class Solution:
    def reverse(self, x: int) -> int:
        r = int(str(abs(x))[::-1]) * (1 if x >= 0 else -1)
        return r if -2**31 <= r < 2**31 else 0
