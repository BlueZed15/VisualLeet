class Solution:
    def getSum(self, a: int, b: int) -> int:
        mask = 0xFFFFFFFF
        while b & mask:
            a, b = a ^ b, (a & b) << 1
        a &= mask
        return a if a <= 0x7FFFFFFF else ~(a ^ mask)
