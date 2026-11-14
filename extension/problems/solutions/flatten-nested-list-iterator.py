class NestedIterator:
    def __init__(self, nestedList: [NestedInteger]):
        self.values = []

        def walk(items):
            for x in items:
                if x.isInteger():
                    self.values.append(x.getInteger())
                else:
                    walk(x.getList())

        walk(nestedList)
        self.i = 0

    def next(self) -> int:
        self.i += 1
        return self.values[self.i - 1]

    def hasNext(self) -> bool:
        return self.i < len(self.values)
