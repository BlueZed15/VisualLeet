class Solution:
    def combinationSum2(self, candidates: List[int], target: int) -> List[List[int]]:
        candidates.sort()
        out = []

        def go(start, left, path):
            if left == 0:
                out.append(path[:])
                return
            for i in range(start, len(candidates)):
                if i > start and candidates[i] == candidates[i - 1]:
                    continue
                if candidates[i] > left:
                    break
                path.append(candidates[i])
                go(i + 1, left - candidates[i], path)
                path.pop()

        go(0, target, [])
        return out
