class WordDictionary:
    def __init__(self):
        self.root = {}

    def addWord(self, word: str) -> None:
        node = self.root
        for c in word:
            node = node.setdefault(c, {})
        node["$"] = True

    def search(self, word: str) -> bool:
        def go(node, i):
            if i == len(word):
                return "$" in node
            if word[i] == ".":
                return any(go(child, i + 1) for k, child in node.items() if k != "$")
            return word[i] in node and go(node[word[i]], i + 1)

        return go(self.root, 0)
