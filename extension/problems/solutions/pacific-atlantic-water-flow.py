class Solution:
    def pacificAtlantic(self, heights: List[List[int]]) -> List[List[int]]:
        rows, cols = len(heights), len(heights[0])

        def reach(starts):
            seen, stack = set(starts), list(starts)
            while stack:
                r, c = stack.pop()
                for a, b in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= a < rows and 0 <= b < cols and (a, b) not in seen and heights[a][b] >= heights[r][c]:
                        seen.add((a, b))
                        stack.append((a, b))
            return seen

        pac = reach([(0, c) for c in range(cols)] + [(r, 0) for r in range(rows)])
        atl = reach([(rows - 1, c) for c in range(cols)] + [(r, cols - 1) for r in range(rows)])
        return [list(x) for x in sorted(pac & atl)]
