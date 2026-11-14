class Solution:
    def rob(self, nums: List[int]) -> int:
        def line(xs):
            a = b = 0
            for n in xs:
                a, b = b, max(b, a + n)
            return b

        if len(nums) == 1:
            return nums[0]
        return max(line(nums[1:]), line(nums[:-1]))
