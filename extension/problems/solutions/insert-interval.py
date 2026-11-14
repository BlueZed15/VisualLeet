class Solution:
    def insert(self, intervals: List[List[int]], newInterval: List[int]) -> List[List[int]]:
        out = []
        s, e = newInterval
        placed = False
        for a, b in intervals:
            if b < s:
                out.append([a, b])
            elif a > e:
                if not placed:
                    out.append([s, e])
                    placed = True
                out.append([a, b])
            else:
                s, e = min(s, a), max(e, b)
        if not placed:
            out.append([s, e])
        return out
