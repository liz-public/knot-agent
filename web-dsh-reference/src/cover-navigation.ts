/** Map a Journal user identity to a native Chat anchor, never to a DOM selector. */
export function queryAnchor(nodes: readonly { id: string; key: string; kind: string; visibility?: string }[], turnId: string) {
  const node = nodes.find(node => node.id === `knot-user-${turnId}` && (node.kind === 'user' || node.kind === 'steering') && node.visibility !== 'hidden')
  return node ? { anchorKey: node.key, anchorTop: 0, scrollTop: 0 } : undefined
}
