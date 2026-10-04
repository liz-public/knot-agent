import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSnapshotDto } from '../../src/workbench/session.js'
import type { ContextMessageDto, ContextProjectionDto } from '../../src/workbench/context-projection.js'
import { download, JsonDetails, Metric, Panel, percent, useRead, type ViewProps } from './inspection-view.tsx'
import { descending } from './inspection-order.ts'

const labels: Record<string, string> = { system: 'System / 固定上下文 / 指令', user: '用户输入', dynamic: '动态上下文',
  assistant: '模型文本', reasoning: '历史推理', tool_arguments: '工具参数', tool_results: '工具结果',
  tool_schemas: '工具 Schema', history_bundle: '压缩任务的历史包', envelope: 'JSON 结构与转义' }
function Message({ message, index }: { message: ContextMessageDto; index: number }) {
  const [open, setOpen] = useState(message.role === 'system')
  return <details className="knot-context-message" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><code>{index + 1}. {message.role}</code><small>约 {message.estimatedTokens.toLocaleString()} tokens（字符估算）</small>
      <span>{message.content?.slice(0, 100) || (message.tool_calls ? '工具调用' : '无文本')}</span></summary>
    {open && <>
      {message.content && <pre className="knot-message-text">{message.content}</pre>}
      {message.reasoning && <details className="knot-data"><summary>历史推理</summary><pre className="knot-message-text">{message.reasoning}</pre></details>}
      {message.tool_calls && <JsonDetails title="工具调用参数" value={message.tool_calls} />}
      {message.tool_call_id && <small>关联调用：{message.tool_call_id}</small>}
    </>}
  </details>
}
function ContextView({ sessionId, useProjection }: ViewProps) {
  const count = useProjection('knotEventCount')
  const source = useRead<SessionSnapshotDto>('knot/journal', { sessionId }, count)
  // Key the selection by Session so a remembered request cannot leak across Sessions.
  const [selection, setSelection] = useState({ sessionId, requestId: '' })
  const invokes = source.value?.events.filter(event => event.type === 'llm.invoke').map(event => ({ position: event.position, ...(event.data as any) })) ?? []
  const chosen = (selection.sessionId === sessionId ? selection.requestId : '') || invokes.at(-1)?.requestId
  const context = useRead<ContextProjectionDto>(chosen ? 'knot/context' : undefined, { sessionId, requestId: chosen }, count)
  const value = context.value
  return <Panel title="上下文分析" note="Journal + manifest 重建的模型输入 · 不是重复存储的日志体积" error={source.error || context.error}
    refresh={() => { source.refresh(); context.refresh() }} actions={value && <Button onClick={() => download(`knot-context-${chosen}.json`, value)}>导出本次输入</Button>}>
    <label className="knot-invoke-picker">模型调用<select aria-label="模型调用" value={chosen ?? ''} onChange={e => setSelection({ sessionId, requestId: e.target.value })}>
      {[...invokes].reverse().map(item => <option key={item.requestId} value={item.requestId}>#{item.position} · {item.request.purpose} · {item.requestId}</option>)}
    </select></label>
    {!source.value ? <p>读取调用列表…</p> : !chosen ? <p>还没有 LLM 调用。</p> : !value ? <p>重建模型输入…</p> : <>
      <div className="knot-metrics"><Metric label="厂商输入 Tokens">{value.usage?.inputTokens?.toLocaleString() ?? '未知'}</Metric>
        <Metric label="规范输入字符">{value.inspection.totalChars.toLocaleString()}</Metric><Metric label="消息数">{value.messages.length}</Metric>
        <Metric label="工具 Schema">{value.tools.length}</Metric></div>
      <p className="knot-inspection-note">以下占比按 UTF-16 字符计量，不是厂商 Token 分段计费。历史推理仅统计本次实际投影的内容。</p>
      <div className="knot-context-breakdown">{descending(value.inspection.breakdown, row => row.share).map(row => <div className="knot-context-part" key={row.key}>
        <span>{labels[row.key] ?? row.key}</span><strong>{percent(row.share)}</strong><progress max={1} value={row.share} />
        <small>{row.chars.toLocaleString()} 字符</small></div>)}</div>
      <details className="knot-data"><summary>上下文来源 / manifest</summary>{value.inspection.sources.map(item => <p key={item.type}>
        <code>{item.type}</code> · {item.positions.length ? item.positions.map(n => '#' + n).join(', ') : '无'} {item.note}</p>)}
        {value.inspection.limitations.map(note => <p className="knot-inspection-note" key={note}>{note}</p>)}</details>
      <h3>实际消息</h3>{value.messages.map((message, index) => <Message key={chosen + ':' + index} message={message} index={index} />)}
      <JsonDetails title="本次工具 Schema" value={value.tools as object} /><JsonDetails title="本次 manifest" value={value.manifest} />
    </>}
  </Panel>
}
export const inject = ['slots']
export function apply(ctx: any) {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'knot-context', order: 40,
    label: () => '上下文分析', inject: (sessionId: string) => ({ sessionId }) }, ContextView))
}
