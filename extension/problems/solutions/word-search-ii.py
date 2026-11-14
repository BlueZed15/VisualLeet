class Solution:
    def findWords(self, board: List[List[str]], words: List[str]) -> List[str]:
        trie = {}
        for w in words:
            node = trie
            for c in w:
                node = node.setdefault(c, {})
            node["$"] = w
        rows, cols, found = len(board), len(board[0]), set()

        def go(r, c, node):
            ch = board[r][c]
            if ch not in node:
                return
            nxt = node[ch]
            if "$" in nxt:
                found.add(nxt["$"])
            board[r][c] = "#"
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                rr, cc = r + dr, c + dc
                if 0 <= rr < rows and 0 <= cc < cols:
                    go(rr, cc, nxt)
            board[r][c] = ch

        for r in range(rows):
            for c in range(cols):
                go(r, c, trie)
        return list(found)
