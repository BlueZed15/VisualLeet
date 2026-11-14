class Solution:
    def findInMountainArray(self, target: int, mountainArr: 'MountainArray') -> int:
        n = mountainArr.length()
        lo, hi = 0, n - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if mountainArr.get(mid) < mountainArr.get(mid + 1):
                lo = mid + 1
            else:
                hi = mid
        peak = lo

        def search(lo, hi, asc):
            while lo <= hi:
                mid = (lo + hi) // 2
                v = mountainArr.get(mid)
                if v == target:
                    return mid
                if (v < target) == asc:
                    lo = mid + 1
                else:
                    hi = mid - 1
            return -1

        i = search(0, peak, True)
        return i if i != -1 else search(peak + 1, n - 1, False)
