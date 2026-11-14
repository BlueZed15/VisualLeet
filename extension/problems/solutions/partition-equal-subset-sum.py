class Solution:
    def canPartition(self, nums: List[int]) -> bool:
        total = sum(nums)
        if total % 2:
            return False
        sums = {0}
        for n in nums:
            sums |= {s + n for s in sums}
        return total // 2 in sums
