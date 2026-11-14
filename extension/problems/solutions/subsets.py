class Solution:
    def subsets(self, nums: List[int]) -> List[List[int]]:
        out = [[]]
        for n in nums:
            out += [s + [n] for s in out]
        return out
