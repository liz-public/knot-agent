/** Session cover is a read-only native View; Chat, input and Session persistence remain DSH-owned. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionCoverDto } from '../../src/workbench/session-cover.js'
import { Metric, percent, useRead, type ViewProps } from './inspection-view.tsx'
import { extendNativeSlot } from './native-slot.ts'
import { queryAnchor } from './cover-navigation.ts'

const states: Record<string, string> = { idle: '空闲', running: '运行中', paused: '已暂停', completed: '已结束', failed: '运行失败' }
const time = (value?: string) => value ? new Date(value).toLocaleString() : '时间未知'

function CoverArt({ sessionId }: { sessionId: string }) {
  const hue = [...sessionId].reduce((n, char) => (n * 31 + char.charCodeAt(0)) % 360, 0)
  return <svg className="knot-cover-art" viewBox="0 0 600 180" aria-hidden="true" style={{ color: `hsl(${hue} 55% 58%)` }}>
    <path d="M-20 125 C90 125 85 38 185 72 S295 155 380 84 S500 35 620 65" />
    {[90, 205, 325, 440, 550].map((x, i) => <g key={x} transform={`translate(${x} ${[100, 80, 119, 53, 55][i]})`}>
      <circle r="13" /><circle r="4" /></g>)}
  </svg>
}

function Cover({ sessionId, useProjection, openView }: ViewProps) {
  const count = useProjection('knotEventCount')
  const [state, setState] = useState('')
  const { value, error, refresh } = useRead<SessionCoverDto>('knot/cover', { sessionId }, `${count}:${state}`)
  const [filter, setFilter] = useState(''), [limit, setLimit] = useState(50)
  useEffect(() => {
    setFilter(''); setLimit(50); setState('')
    const abort = new AbortController()
    void (async () => {
      for await (const event of (window as any).__DSH_TRANSPORT__.rpc.open('$knot', 'knot/live', { args: [{ sessionId }] }, abort.signal)) {
        if (!abort.signal.aborted && event.kind === 'state.changed') setState(event.runState)
      }
    })().catch(() => { /* The read endpoint owns errors; live state is optional for archives. */ })
    return () => abort.abort()
  }, [sessionId])
  if (!value) return <section className="knot-cover"><p role={error ? 'alert' : undefined}>{error || '读取会话封面…'}</p><Button onClick={refresh}>重试</Button></section>
  const { session, usage, goal, todos, recordedConfiguration } = value
  const queries = value.queries.filter(query => query.content.toLowerCase().includes(filter.toLowerCase()))
  const inference = recordedConfiguration.inference
  return <section className="knot-cover">
    <header className="knot-cover-hero"><CoverArt sessionId={sessionId} /><div className="knot-cover-title">
      <small>JOURNAL · 结绳记事</small><h1>{session.title}</h1><div className="knot-cover-tags"><Pill>{states[session.runState] ?? session.runState}</Pill>
        <Pill>{session.assembly}</Pill>{!session.writable && <Pill>只读记录</Pill>}</div>
      <p>{value.queries.length ? '从记录了解这段会话，再继续它。' : '会话已准备好。在下方输入你的第一个请求。'}</p>
      <Button onClick={() => openView('chat', 'latest')}>{session.writable ? '进入对话 / 继续任务' : '查看对话'}</Button>
    </div></header>
    {error && <p role="alert">{error}</p>}
    <div className="knot-cover-meta"><span>工作目录 <code>{session.workspace ?? '未记录'}</code></span>
      <span>首次记录 {time(value.firstObservedAt)}</span><span>最近记录 {time(value.lastObservedAt)}</span>
      <span>已生效模型 {inference?.model ?? '未记录'} · 推理 {inference?.reasoningEffort ?? '默认'} · 审批 {recordedConfiguration.approvalMode ?? '未记录'}</span>
      {session.writable && <span>下一轮配置 {session.model ?? '默认'} · 推理 {session.reasoningEffort ?? '默认'} · 审批 {session.approvalMode ?? '默认'}（输入栏可调整）</span>}
    </div>
    {value.queries.length > 0 && <><div className="knot-metrics"><Metric label="用户输入">{value.queries.length}</Metric><Metric label="Journal 事件">{value.eventCount.toLocaleString()}</Metric>
      <Metric label="模型返回">{usage.calls}</Metric><Metric label="工具调用">{value.toolCalls}</Metric>
      <Metric label={`累计 Tokens${usage.knownCalls < usage.calls ? '（部分）' : ''}`}>{usage.knownCalls ? usage.totalTokens.toLocaleString() : '未知'}</Metric>
      <Metric label="已知调用加权缓存率">{percent(usage.knownCacheHitRate)}</Metric></div>
    <p className="knot-cover-note">用户输入包含轮内追加请求，不等于完成轮数。Usage {usage.knownCalls}/{usage.calls} 次 · 缓存计数 {usage.cacheKnownCalls}/{usage.calls} 次；包含压缩调用，不把缺失计数当作零。
      {value.unfinishedToolCalls > 0 && ` ${value.unfinishedToolCalls} 次调用尚无结果（不等于失败）。`}</p></>}
    {(goal || todos?.length) ? <div className="knot-cover-work">
      {goal && <article><h2>目标 <Pill>{goal.status === 'completed' ? '已完成' : '进行中'}</Pill></h2><p>{goal.objective}</p>
        {goal.successCriteria?.length > 0 && <details><summary>完成条件</summary><ul>{goal.successCriteria.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}</article>}
      {todos?.length ? <article><h2>待办 <Pill>{todos.filter(item => item.status === 'completed').length}/{todos.length}</Pill></h2>
        <ul className="knot-cover-todos">{todos.map(item => <li key={item.id}><span>{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◉' : '○'}</span>{item.content}</li>)}</ul></article> : null}
    </div> : null}
    {value.latestReply && <article className="knot-cover-reply"><h2>最近一次回复 <small>原文摘录，不是生成摘要</small></h2>
      <details><summary>{value.latestReply.content.slice(0, 240)}{value.latestReply.content.length > 240 ? '…' : ''}</summary><pre>{value.latestReply.content}</pre></details></article>}
    {value.queries.length > 0 && <><header className="knot-cover-directory"><h2>Query 目录 <small>{value.queries.length} 条原始输入</small></h2>
      <Input aria-label="搜索用户输入" placeholder="搜索原始请求" value={filter} onChange={e => { setFilter(e.target.value); setLimit(50) }} /></header>
    {!queries.length && <p className="knot-cover-note">{filter ? '没有匹配的请求。' : '尚无用户输入。'}</p>}
    <ol className="knot-cover-queries">{queries.slice(0, limit).map(query => <li key={query.position}>
      <div><small>#{query.position} · {time(query.observedAt)}</small><details><summary>{query.content.slice(0, 180)}{query.content.length > 180 ? '…' : ''}</summary><pre>{query.content}</pre></details></div>
      <Button disabled={!query.turnId} onClick={() => openView('chat', `user:${query.turnId}`)}>查看原对话</Button>
    </li>)}</ol>
    {queries.length > limit && <Button onClick={() => setLimit(n => n + 50)}>显示更多请求</Button>}</>}
    <footer className="knot-cover-links"><Button onClick={() => openView('knot-tools', '')}>工具统计</Button><Button onClick={() => openView('knot-context', '')}>上下文分析</Button>
      <Button onClick={() => openView('knot-plugins', '')}>插件与协议</Button><Button onClick={refresh}>刷新封面</Button></footer>
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
