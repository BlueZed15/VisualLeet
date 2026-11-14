class Solution:
    def lastStoneWeight(self, stones: List[int]) -> int:
        heap = [-s for s in stones]
        heapify(heap)
        while len(heap) > 1:
            a, b = -heappop(heap), -heappop(heap)
            if a != b:
                heappush(heap, -(a - b))
        return -heap[0] if heap else 0
