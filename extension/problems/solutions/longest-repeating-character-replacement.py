class Solution:
    def characterReplacement(self, s: str, k: int) -> int:
        count, start, top, best = Counter(), 0, 0, 0
        for i, c in enumerate(s):
            count[c] += 1
            top = max(top, count[c])
            while i - start + 1 - top > k:
                count[s[start]] -= 1
                start += 1
            best = max(best, i - start + 1)
        return best
