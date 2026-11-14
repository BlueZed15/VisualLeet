class Solution:
    def searchMatrix(self, matrix: List[List[int]], target: int) -> bool:
        flat = [v for row in matrix for v in row]
        i = bisect_left(flat, target)
        return i < len(flat) and flat[i] == target
