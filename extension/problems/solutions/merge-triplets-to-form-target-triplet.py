class Solution:
    def mergeTriplets(self, triplets: List[List[int]], target: List[int]) -> bool:
        good = set()
        for t in triplets:
            if all(t[i] <= target[i] for i in range(3)):
                good |= {i for i in range(3) if t[i] == target[i]}
        return len(good) == 3
