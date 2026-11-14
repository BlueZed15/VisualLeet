class Solution:
    def eraseOverlapIntervals(self, intervals: List[List[int]]) -> int:
        end, removed = float("-inf"), 0
        for a, b in sorted(intervals, key=lambda x: x[1]):
            if a >= end:
                end = b
            else:
                removed += 1
        return removed
