class Solution:
    def partition(self, s: str) -> List[List[str]]:
        out = []

        def go(start, path):
            if start == len(s):
                out.append(path[:])
                return
            for end in range(start + 1, len(s) + 1):
                part = s[start:end]
                if part == part[::-1]:
                    path.append(part)
                    go(end, path)
                    path.pop()

        go(0, [])
        return out
