class Solution:
    def maxProduct(self, nums: List[int]) -> int:
        best = hi = lo = nums[0]
        for n in nums[1:]:
            hi, lo = max(n, hi * n, lo * n), min(n, hi * n, lo * n)
            best = max(best, hi)
        return best
