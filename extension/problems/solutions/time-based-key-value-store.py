class TimeMap:
    def __init__(self):
        self.data = defaultdict(list)

    def set(self, key: str, value: str, timestamp: int) -> None:
        self.data[key].append((timestamp, value))

    def get(self, key: str, timestamp: int) -> str:
        items = self.data.get(key, [])
        i = bisect_right(items, (timestamp, chr(0x10FFFF)))
        return items[i - 1][1] if i else ""
