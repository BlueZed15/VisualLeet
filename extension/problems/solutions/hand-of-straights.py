class Solution:
    def isNStraightHand(self, hand: List[int], groupSize: int) -> bool:
        count = Counter(hand)
        for x in sorted(count):
            n = count[x]
            if n:
                for y in range(x, x + groupSize):
                    if count[y] < n:
                        return False
                    count[y] -= n
        return True
