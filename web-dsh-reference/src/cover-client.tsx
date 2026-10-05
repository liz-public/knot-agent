/** Session cover is a read-only native View; Chat, input and Session persistence remain DSH-owned. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionCoverDto } from '../../src/workbench/session-cover.js'
import { Metric, percent, useRead, type ViewProps } from './inspection-view.tsx'
import { extendNativeSlot } from './native-slot.ts'
import { queryAnchor } from './cover-navigation.ts'
import { CoverHero } from './cover-hero.tsx'

const states: Record<string, string> = { idle: '空闲', running: '运行中', paused: '已暂停', completed: '已结束', failed: '运行失败' }
const time = (value?: string) => value ? new Date(value).toLocaleString() : '时间未知'
const duration = (ms?: number) => ms === undefined ? '未知' :
  `${Math.floor(ms / 3600000) ? Math.floor(ms / 3600000) + ' 小时 ' : ''}${Math.floor(ms / 60000) % 60} 分 ${Math.floor(ms / 1000) % 60} 秒`

function CoverArt({ sessionId }: { sessionId: string }) {
  const hue = [...sessionId].reduce((n, char) => (n * 31 + char.charCodeAt(0)) % 360, 0)
  return <svg className="knot-cover-art" viewBox="0 0 600 180" aria-hidden="true" style={{ color: `hsl(${hue} 55% 58%)` }}>
    <path d="M-20 125 C90 125 85 38 185 72 S295 155 380 84 S500 35 620 65" />
    {[90, 205, 325, 440, 550].map((x, i) => <g key={x} transform={`translate(${x} ${[100, 80, 119, 53, 55][i]})`}>
      <circle r="13" /><circle r="4" /></g>)}
  </svg>
}

function Cover({ sessionId, useProjection, openView }: ViewProps) {
  const title = useProjection('title')
  const subagentCount = useProjection('subagentCatalog')?.length ?? 0
  const { value, error, refresh } = useRead<SessionCoverDto>('knot/cover', { sessionId })
  const [filter, setFilter] = useState(''), [limit, setLimit] = useState(50)
  useEffect(() => {
    setFilter(''); setLimit(50)
  }, [sessionId])
  if (!value) return <section className="knot-cover"><p role={error ? 'alert' : undefined}>{error || '读取会话封面…'}</p>{error && <Button onClick={refresh}>重试</Button>}</section>
  const { session, usage, goal, todos, recordedConfiguration } = value
  const queries = value.queries.filter(query => query.content.toLowerCase().includes(filter.toLowerCase()))
  const inference = recordedConfiguration.inference
  return <section className="knot-cover">
    <CoverHero key={sessionId} sessionId={sessionId}><CoverArt sessionId={sessionId} /><div className="knot-cover-title">
      <small>JOURNAL · 结绳记事</small><h1>{title ?? session.title}</h1><div className="knot-cover-tags"><Pill>{states[session.runState] ?? session.runState}</Pill>
        <Pill>{session.assembly}</Pill>{!session.writable && <Pill>只读记录</Pill>}</div>
      <p>{value.queries.length ? '从记录了解这段会话，再继续它。' : '会话已准备好。在下方输入你的第一个请求。'}</p>
      <Button variant="primary" onClick={() => openView('chat', 'latest')}>{session.writable ? '进入对话 / 继续任务' : '查看对话'} <span aria-hidden="true">→</span></Button>
    </div></CoverHero>
    {error && <p role="alert">{error}</p>}
    <div className="knot-cover-meta"><span><small>工作目录</small><code title={session.workspace}>{session.workspace ?? '未记录'}</code></span>
      <span><small>首次记录</small>{time(value.firstObservedAt)}</span><span><small>最近记录</small>{time(value.lastObservedAt)}</span>
      <span><small>已生效模型</small>{inference?.model ?? '未记录'} · 推理 {inference?.reasoningEffort ?? '默认'} · 审批 {recordedConfiguration.approvalMode ?? '未记录'}</span>
    </div>
    {value.queries.length > 0 && <div className="knot-metrics"><Metric label="用户输入">{value.queries.length}</Metric><Metric label="Journal 事件">{value.eventCount.toLocaleString()}</Metric>
      <Metric label="模型返回">{usage.calls}</Metric><Metric label="工具调用">{value.toolCalls}</Metric>
      <Metric label="子智能体">{subagentCount}</Metric><Metric label="历史压缩">{value.compactionCount}</Metric>
      <Metric label={`累计 Tokens${usage.knownCalls < usage.calls ? '（部分）' : ''}`}>{usage.knownCalls ? usage.totalTokens.toLocaleString() : '未知'}</Metric>
      <Metric label={`累计运行时长${value.runDurationPartial ? '（已记录）' : ''}`}>{duration(value.runDurationMs)}</Metric></div>
    }
    {value.modelUsage.length > 0 && <article className="knot-cover-models"><h2>模型生成构成 <small>按调用前生效的配置统计</small></h2>
      <div className="knot-cover-table-scroll"><table><thead><tr><th>模型 / 推理强度</th><th>调用</th><th>生成 Tokens</th><th>生成占比</th><th>平均吞吐率</th></tr></thead>
        <tbody>{value.modelUsage.map((row, i) => <tr key={i}><td><strong>{row.model ?? '未记录模型'}</strong><small>{row.provider ?? '未记录来源'} · {row.model === undefined ? '未记录强度' : row.reasoningEffort ?? '默认强度'}</small></td>
          <td>{row.calls}</td><td>{row.outputKnownCalls ? row.outputTokens.toLocaleString() : '未知'}{row.outputKnownCalls < row.calls && row.outputKnownCalls > 0 ? '（部分）' : ''}</td>
          <td><div className="knot-cover-share"><progress max={1} value={row.outputShare ?? 0} aria-label={`${row.model ?? '未知模型'}生成占比`} /><span>{percent(row.outputShare)}</span></div></td>
          <td title={`有 Token 与耗时记录的 ${row.timedCalls}/${row.calls} 次调用`}>{row.outputRate === undefined ? '—' : `${row.outputRate.toFixed(1)} tok/s`}</td></tr>)}</tbody></table></div>
    </article>}
    <div className="knot-cover-columns"><article className="knot-cover-query-panel">
      <header className="knot-cover-directory"><h2>Query 目录 <small>{value.queries.length} 条原始输入</small></h2>
        <Input aria-label="搜索用户输入" placeholder="搜索原始请求" value={filter} onChange={e => { setFilter(e.target.value); setLimit(50) }} /></header>
      {!queries.length && <p className="knot-cover-note">{filter ? '没有匹配的请求。' : '尚无用户输入。'}</p>}
      <ol className="knot-cover-queries">{queries.slice(0, limit).map(query => <li key={query.position}>
        <button className="knot-cover-query" title={query.content} disabled={!query.turnId} onClick={() => openView('chat', `user:${query.turnId}`)}>
          <small>#{query.position}</small><span className="knot-cover-query-text">{query.content}</span><time dateTime={query.observedAt} title={time(query.observedAt)}>{query.observedAt ? new Date(query.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</time>
        </button>
      </li>)}</ol>
      {queries.length > limit && <Button onClick={() => setLimit(n => n + 50)}>显示更多请求</Button>}
    </article><aside className="knot-cover-work">
      <article><h2>待办 <Pill>{todos?.filter(item => item.status === 'completed').length ?? 0}/{todos?.length ?? 0}</Pill></h2>
        {todos?.length ? <ul className="knot-cover-todos">{todos.map(item => <li key={item.id}><span>{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◉' : '○'}</span>{item.content}</li>)}</ul>
          : <p className="knot-cover-note">尚未记录待办。</p>}</article>
      {goal && <article><h2>目标 <Pill>{goal.status === 'completed' ? '已完成' : '进行中'}</Pill></h2><p>{goal.objective}</p>
        {goal.successCriteria?.length > 0 && <details><summary>完成条件</summary><ul>{goal.successCriteria.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}</article>}
      <article className="knot-cover-reply"><h2>最近一次回复 <small>原文摘录</small></h2>
        {value.latestReply ? <><p>{value.latestReply.content.slice(0, 240)}{value.latestReply.content.length > 240 ? '…' : ''}</p>
          <details><summary>查看完整回复</summary><pre>{value.latestReply.content}</pre></details></> : <p className="knot-cover-note">尚未记录回复。</p>}</article>
    </aside></div>
  </section>
}

export const inject = ['slots']
export function apply(ctx: any) {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'knot-cover', order: -10,
    label: () => '会话封面', inject: (sessionId: string) => ({ sessionId }) }, Cover))
  // Use the native per-Session UI preference. Blank Sessions keep their native Hero/composer.
  extendNativeSlot(ctx, 'conversation.session', () => true, native => {
    const Original = native.component
    function Session(props: any) {
      const selected = props.useStore((s: any) => s.view)
      const submitting = props.useSession((s: any) => s.pendingSubmissions.length > 0)
      useEffect(() => { if (selected === null) props.actions.setView('knot-cover') }, [selected, props.actions])
      useEffect(() => { if (submitting && selected === 'knot-cover') props.openView('chat', 'latest') }, [submitting, selected, props.openView])
      return <Original {...props} view={selected === null ? 'knot-cover' : props.view} />
    }
    ctx.effect(() => { native.component = Session; return () => { native.component = Original } })
  })
  extendNativeSlot(ctx, 'conversation.view', entry => entry.options.id === 'chat', native => {
    const Original = native.component
    function Chat(props: any) {
      const request = props.viewRequest?.view === 'chat' ? props.viewRequest : null
      // Capture the one-shot request before acknowledging it; the native reader restores on mount.
      const focus = useRef(request?.focus).current
      const anchorKey = props.useChat((s: any) => focus?.startsWith('user:') ? queryAnchor(s.nodes.values(), focus.slice(5))?.anchorKey : undefined)
      const anchor = useMemo(() => anchorKey ? { anchorKey, anchorTop: 0, scrollTop: 0 } : undefined, [anchorKey])
      const scroll = useMemo(() => {
        let seeded = focus === 'latest' || anchor !== undefined
        return { read: () => seeded ? anchor ?? null : props.chatScroll.read(),
          save: (position: any) => { seeded = false; props.chatScroll.save(position) } }
      }, [props.chatScroll, anchor, focus])
      const ready = props.useSession((s: any) => s.openState === 'open')
      useEffect(() => { if (request && ready) props.completeViewRequest() }, [request, ready, props.completeViewRequest])
      return <>{ready && focus?.startsWith('user:') && !anchor && <p className="knot-cover-note">该请求没有可定位的 Chat 消息；仍可查看原始 Journal。</p>}
        <Original {...props} chatScroll={scroll} /></>
    }
    ctx.effect(() => { native.component = Chat; return () => { native.component = Original } })
  })
}
