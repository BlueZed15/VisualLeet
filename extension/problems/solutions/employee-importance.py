class Solution:
    def getImportance(self, employees: List['Employee'], id: int) -> int:
        by_id = {e.id: e for e in employees}

        def total(i):
            e = by_id[i]
            return e.importance + sum(total(s) for s in e.subordinates)

        return total(id)
