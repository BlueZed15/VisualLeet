class Solution:
    def largestRectangleArea(self, heights: List[int]) -> int:
        stack, best = [], 0
        for i, h in enumerate(heights + [0]):
            start = i
            while stack and stack[-1][1] >= h:
                j, hh = stack.pop()
                best = max(best, hh * (i - j))
                start = j
            stack.append((start, h))
        return best
