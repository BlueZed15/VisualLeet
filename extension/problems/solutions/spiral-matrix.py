class Solution:
    def spiralOrder(self, matrix: List[List[int]]) -> List[int]:
        out = []
        while matrix:
            out += matrix.pop(0)
            matrix = [list(r) for r in zip(*matrix)][::-1]
        return out
