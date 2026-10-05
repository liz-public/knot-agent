/** DSH's inbox normally has a durable-log watermark. Knot's unsubmitted input
 * is Host-owned, so only this value uses an explicit Host epoch/revision.
 * Preserve native Journal seqs and all other projection deduplication rules.
 */
export function extendNativeInbox(source: string): string {
  const before = 'if (row?.kind === "sequenced" && seq <= row.seq) return;'
  if (source.split(before).length !== 2) throw new Error('DSH inbox extension no longer matches 0.2.0-rc.1')
  return source.replace(before, `if (row?.kind === "sequenced") {
    const incoming = key === "inbox" ? value?.knotQueueVersion : undefined;
    const previous = row.value?.knotQueueVersion;
    if (incoming) {
      if (previous?.epoch === incoming.epoch && (incoming.revision < previous.revision ||
        incoming.revision === previous.revision && seq <= row.seq)) return;
    } else if (seq <= row.seq) return;
  }`)
}
