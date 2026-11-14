class Solution:
    def findTargetSumWays(self, nums: List[int], target: int) -> int:
        ways = Counter({0: 1})
        for n in nums:
            nxt = Counter()
            for s, c in ways.items():
                nxt[s + n] += c
                nxt[s - n] += c
            ways = nxt
        return ways[target]
