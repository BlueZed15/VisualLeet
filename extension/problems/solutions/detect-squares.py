class DetectSquares:
    def __init__(self):
        self.points = Counter()

    def add(self, point: List[int]) -> None:
        self.points[tuple(point)] += 1

    def count(self, point: List[int]) -> int:
        x, y = point
        total = 0
        for (a, b), n in list(self.points.items()):
            if abs(a - x) == abs(b - y) and a != x:
                total += n * self.points[(a, y)] * self.points[(x, b)]
        return total
