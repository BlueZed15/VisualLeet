class Solution:
    def minInterval(self, intervals: List[List[int]], queries: List[int]) -> List[int]:
        intervals = sorted(intervals)
        heap, out, i = [], {}, 0
        for q in sorted(set(queries)):
            while i < len(intervals) and intervals[i][0] <= q:
                a, b = intervals[i]
                heappush(heap, (b - a + 1, b))
                i += 1
            while heap and heap[0][1] < q:
                heappop(heap)
            out[q] = heap[0][0] if heap else -1
        return [out[q] for q in queries]
