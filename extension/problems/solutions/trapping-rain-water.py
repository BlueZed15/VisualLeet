class Solution:
    def trap(self, height: List[int]) -> int:
        i, j = 0, len(height) - 1
        lmax = rmax = water = 0
        while i < j:
            if height[i] < height[j]:
                lmax = max(lmax, height[i])
                water += lmax - height[i]
                i += 1
            else:
                rmax = max(rmax, height[j])
                water += rmax - height[j]
                j -= 1
        return water
