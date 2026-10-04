/** Raw Journal tracking; no tools, model-input or metadata analysis owned here. */
import { useEffect, useState } from 'react'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSnapshotDto } from '../../src/workbench/session.js'
import { JsonDetails, Panel, useRead, type ViewProps } from './inspection-view.tsx'

function JournalView({ sessionId, useProjection, viewRequest, completeViewRequest }: ViewProps) {
  const { value: source, error, refresh } = useRead<SessionSnapshotDto>('knot/journal', { sessionId }, useProjection('knotEventCount'))
  const [filter, setFilter] = useState(''), [tool, setTool] = useState(''), [limit, setLimit] = useState(100)
  useEffect(() => { setFilter(''); setTool(''); setLimit(100) }, [sessionId])
  useEffect(() => {
    if (viewRequest?.view !== 'knot-inspection' || !viewRequest.focus.startsWith('tool:')) return
    setTool(viewRequest.focus.slice(5)); setFilter(''); setLimit(100); completeViewRequest()
  }, [viewRequest, completeViewRequest])
  const ids = new Set(source?.events.flatMap(event => event.type === 'tool.call'
    ? (event.data as any).calls.filter((call: any) => call.name === tool).map((call: any) => call.callId) : []) ?? [])
  const events = source?.events.filter(event => (!filter || (event.type + ' ' + JSON.stringify(event.data)).toLowerCase().includes(filter.toLowerCase()))
    && (!tool || ((event.data as any)?.calls ?? (event.data as any)?.results ?? []).some((item: any) => ids.has(item.callId)))) ?? []
  return <Panel title="Knot Inspector" note="Journal 原始事实 · 时间来自 JSONL 元数据，不进入内核" error={error} refresh={refresh}>
    <div className="knot-inspection-toolbar"><Input aria-label="过滤 Journal" placeholder="过滤事件类型或内容" value={filter}
      onChange={e => { setFilter(e.target.value); setLimit(100) }} />{tool && <Pill onClick={() => setTool('')}>{tool} ×</Pill>}</div>
    <p className="knot-inspection-note">{source ? `${events.length} 个匹配事实 · 显示最近 ${Math.min(limit, events.length)} 个` : '读取 Journal…'}</p>
    <div className="knot-event-list">{events.slice(-limit).map(event => {
      const data = event.data as any
      const preview = data?.content ?? data?.query ?? data?.purpose ?? data?.request?.purpose
        ?? (data?.calls ?? data?.results)?.map((item: any) => item.name ?? item.callId).join(' · ') ?? ''
      return <article className="knot-event" key={event.position}><div className="knot-event-mark">#{event.position}</div><div className="knot-event-body">
        <header><code>{event.type}</code><time>{event.observedAt ? new Date(event.observedAt).toLocaleTimeString() : '时间未知'}</time></header>
        {typeof preview === 'string' && preview && <p className="knot-event-preview">{preview.slice(0, 180)}</p>}
        <JsonDetails title="事件数据" value={event.data as object} /></div></article>
    })}</div>
    {limit < events.length && <Button onClick={() => setLimit(n => n + 100)}>显示更早的 100 个</Button>}
  </Panel>
}
export const inject = ['slots']
export function apply(ctx: any) {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'knot-inspection', order: 20,
    label: () => 'Knot Inspector', inject: (sessionId: string) => ({ sessionId }) }, JournalView))
}
