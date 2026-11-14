class Solution:
    def flatten(self, head: 'Optional[Node]') -> 'Optional[Node]':
        node, stack = head, []
        while node:
            if node.child:
                if node.next:
                    stack.append(node.next)
                node.next, node.child.prev, node.child = node.child, node, None
            elif not node.next and stack:
                nxt = stack.pop()
                node.next, nxt.prev = nxt, node
            node = node.next
        return head
