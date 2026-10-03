/** Transient display translation only; final content always comes from the Journal. */
export class GenerationProjection {
  revision = 0
  active?: { id: string; index: number; turn: number; step: number; blocks: Map<string, number>; calls: Map<number, { id: string; name: string }> }

  start(id: string, coordinates: { turn: number; step: number }, cursor: number) {
    this.active = { id, ...coordinates, index: 0, blocks: new Map(), calls: new Map() }
    return this.frame({ type: 'start', attemptId: id, startedAfterSeq: cursor, ...coordinates })
  }
  update(id: string, update: any, time: number) {
    const active = this.active
    if (!active || active.id !== id) return []
    if (!['content', 'reasoning', 'tool_call'].includes(update.kind)) return []
    const frames: unknown[] = []
    const key = update.kind === 'tool_call' ? `call:${update.index}` : update.kind
    let index = active.blocks.get(key)
    if (index === undefined) {
      index = active.blocks.size
      active.blocks.set(key, index)
      frames.push(this.chunk({ type: 'block-start', index, blockType: update.kind === 'tool_call' ? 'tool-call' : update.kind === 'content' ? 'text' : 'reasoning' }, time))
    }
    if (update.kind === 'tool_call') {
      const call = active.calls.get(update.index) ?? { id: '', name: '' }
      call.id += update.id ?? ''; call.name += update.name ?? ''
      active.calls.set(update.index, call)
      frames.push(this.chunk({ type: 'tool-call-delta', index, id: call.id, ...(call.name ? { name: call.name } : {}), argumentsDelta: update.argumentsDelta ?? '' }, time))
    } else frames.push(this.chunk({ type: update.kind === 'content' ? 'text-delta' : 'reasoning-delta', index, text: update.text }, time))
    return frames
  }
  end(seq?: number) {
    const active = this.active
    if (!active) return undefined
    const frame = this.frame({ type: 'end', attemptId: active.id, index: active.index,
      outcome: seq === undefined ? { kind: 'abandoned' } : { kind: 'committed', eventType: 'assistant/message', seq } })
    this.active = undefined
    return frame
  }
  private chunk(chunk: unknown, time: number) {
    return this.frame({ type: 'chunk', attemptId: this.active!.id, index: this.active!.index++, time, chunk })
  }
  private frame(value: Record<string, unknown>) {
    return { type: 'assistant-stream', frame: { ...value, revision: ++this.revision } }
  }
}
