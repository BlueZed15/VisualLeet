class Solution:
    def alienOrder(self, words: List[str]) -> str:
        graph = {c: set() for w in words for c in w}
        for a, b in zip(words, words[1:]):
            for x, y in zip(a, b):
                if x != y:
                    graph[x].add(y)
                    break
            else:
                if len(a) > len(b):
                    return ""
        indeg = {c: 0 for c in graph}
        for x in graph:
            for y in graph[x]:
                indeg[y] += 1
        queue = deque(c for c in graph if indeg[c] == 0)
        out = []
        while queue:
            x = queue.popleft()
            out.append(x)
            for y in graph[x]:
                indeg[y] -= 1
                if indeg[y] == 0:
                    queue.append(y)
        return "".join(out) if len(out) == len(graph) else ""
