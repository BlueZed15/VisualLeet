class Solution:
    def minMeetingRooms(self, intervals: List[List[int]]) -> int:
        ends = []
        for a, b in sorted(intervals):
            if ends and ends[0] <= a:
                heapreplace(ends, b)
            else:
                heappush(ends, b)
        return len(ends)
