class Solution:
    def ladderLength(self, beginWord: str, endWord: str, wordList: List[str]) -> int:
        words = set(wordList)
        if endWord not in words:
            return 0
        queue, seen = deque([(beginWord, 1)]), {beginWord}
        while queue:
            w, d = queue.popleft()
            if w == endWord:
                return d
            for i in range(len(w)):
                for ch in "abcdefghijklmnopqrstuvwxyz":
                    nw = w[:i] + ch + w[i + 1:]
                    if nw in words and nw not in seen:
                        seen.add(nw)
                        queue.append((nw, d + 1))
        return 0
