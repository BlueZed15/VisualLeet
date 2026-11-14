class Solution:
    def minWindow(self, s: str, t: str) -> str:
        need = Counter(t)
        missing = len(t)
        start = best_i = 0
        best_len = float("inf")
        for j, c in enumerate(s):
            if need[c] > 0:
                missing -= 1
            need[c] -= 1
            while missing == 0:
                if j - start + 1 < best_len:
                    best_i, best_len = start, j - start + 1
                need[s[start]] += 1
                if need[s[start]] > 0:
                    missing += 1
                start += 1
        return "" if best_len == float("inf") else s[best_i:best_i + best_len]
