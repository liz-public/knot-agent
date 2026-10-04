import type { Event } from '../journal.js'
import { isDynamicContextMessage } from '../agent/projection.js'
import type { ChatMessage, LlmInvoke } from '../agent/protocol.js'

export interface ContextInspection {
  readonly totalChars: number
  readonly breakdown: readonly { readonly key: string; readonly chars: number; readonly share: number }[]
  readonly sources: readonly { readonly type: string; readonly positions: readonly number[]; readonly note?: string }[]
  readonly limitations: readonly string[]
}

/** Analyse the already-reconstructed input; never tally duplicate Journal payloads as model context. */
export function inspectModelContext(events: readonly Event[], invoke: LlmInvoke,
  messages: readonly ChatMessage[], tools: readonly Record<string, unknown>[]): ContextInspection {
  const counts: Record<string, number> = { system: 0, user: 0, dynamic: 0, assistant: 0,
    reasoning: 0, tool_arguments: 0, tool_results: 0, history_bundle: 0, tool_schemas: 0, envelope: 0 }
  for (const message of messages) {
    const key = message.role === 'tool' ? 'tool_results'
      : isDynamicContextMessage(message) ? 'dynamic'
      : invoke.manifest.kind === 'compress' && message.role === 'user' ? 'history_bundle' : message.role
    counts[key]! += message.content?.length ?? 0
    counts['reasoning']! += message.reasoning?.length ?? 0
    for (const call of message.tool_calls ?? []) counts['tool_arguments']! += call.function.arguments.length
  }
  counts['tool_schemas'] = tools.length ? JSON.stringify(tools).length : 0
  const totalChars = JSON.stringify({ messages, tools }).length
  counts['envelope'] = totalChars - Object.values(counts).reduce((sum, n) => sum + n, 0)
  const through = events.findIndex(event => event.type === 'llm.invoke' && (event.data as any)?.requestId === invoke.requestId)
  const prefix = events.slice(0, through)
  const positions = (type: string, matches: (data: any) => boolean = () => true) => prefix.flatMap((event, position) =>
    event.type === type && matches(event.data) ? [position] : [])
  const sources: ContextInspection['sources'][number][] = []
  const manifest = invoke.manifest
  if (manifest.kind === 'agent') {
    for (const type of ['system.prompt', 'context.fixed']) sources.push({ type, positions: positions(type) })
    sources.push({ type: 'context.dynamic', positions: positions('context.dynamic', data => data.turnId === manifest.dynamicTurnId).slice(-1) })
    sources.push({ type: 'tool.registry', positions: positions('tool.registry').slice(-1) })
  }
  if (invoke.manifest.summaryOfRequirementId) sources.push({ type: 'history.checkpoint',
    positions: positions('history.checkpoint', data => data.requirementId === invoke.manifest.summaryOfRequirementId).slice(-1) })
  const after = invoke.manifest.tailAfterRequestId
  const start = after ? prefix.findIndex(event => event.type === 'llm.generated' && (event.data as any)?.requestId === after) + 1 : 0
  const end = manifest.kind === 'compress'
    ? events.findIndex(event => event.type === 'llm.generated' && (event.data as any)?.requestId === manifest.tailThroughRequestId) : through - 1
  sources.push({ type: 'history tail', positions: end >= start ? [start, end] : [], note: 'Inclusive Journal range; only semantic messages are projected, not every event.' })
  sources.push({ type: 'llm.invoke', positions: [through], note: 'Manifest and optional per-request instruction.' })
  return { totalChars, breakdown: Object.entries(counts).filter(([, chars]) => chars > 0)
    .map(([key, chars]) => ({ key, chars, share: chars / totalChars })), sources,
    limitations: ['Lengths are UTF-16 characters of the canonical input, not provider tokens or HTTP bytes.',
      'System combines prompt, fixed context, summary and request guidance; compression history stays a serialized bundle.',
      'Reasoning counts only content actually projected into this invocation, not every generation in the Session.'] }
}
