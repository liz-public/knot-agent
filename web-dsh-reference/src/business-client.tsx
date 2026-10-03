/** Knot-only presentation contributions; native DSH Chat/Trajectory stay intact. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSnapshotDto, SessionSummaryDto } from '../../src/workbench/session.js'
import type { StudioAssemblyDto } from '../../src/workbench/studio.js'
import type { ContextProjectionDto } from '../../src/workbench/context-projection.js'

type Call = (endpoint: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<any>
type Inspection = SessionSnapshotDto & { assembly?: StudioAssemblyDto; children: SessionSummaryDto[] }
const percent = (value: number) => (value * 100).toFixed(2) + '%'

function TaskState({ useProjection }: any) {
  const todos = useProjection('knotTodo')
  const goal = useProjection('knotGoal')
  if (!Array.isArray(todos) && !goal) return null
  return <div className="knot-task-state">
    {goal && <details><summary>◎ Goal · {goal.status} · {goal.objective}</summary>
      <ul>{goal.successCriteria?.map((value: string, i: number) => <li key={i}>{value}</li>)}</ul></details>}
    {Array.isArray(todos) && <details><summary>☑ Todo · {todos.filter(item => item.status === 'completed').length}/{todos.length}</summary>
      <ul>{todos.map((item: any) => <li key={item.id}><span>{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◉' : '○'}</span> {item.content}</li>)}</ul></details>}
  </div>
}

function EventRow({ event }: { event: Inspection['events'][number] }) {
  const [open, setOpen] = useState(false)
  const data = event.data as any
  const preview = data?.content ?? data?.query ?? data?.purpose ?? data?.request?.purpose ?? ''
  return <details onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><code>#{event.position} {event.type}</code> <time>{event.observedAt ? new Date(event.observedAt).toLocaleTimeString() : '时间未知'}</time>
      <span>{typeof preview === 'string' ? preview.slice(0, 120) : ''}</span></summary>
    {open && <pre>{JSON.stringify(event.data, null, 2)}</pre>}
  </details>
}

function DataDetails({ title, value, initiallyOpen = false }: { title: string; value: unknown; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{title}</summary>{open && <pre>{JSON.stringify(value, null, 2)}</pre>}
  </details>
}

function InspectionView({ call, sessionId, openChild, useProjection }: { call: Call; sessionId: string; openChild: (id: string) => void; useProjection: (key: string) => any }) {
  const count = useProjection('knotEventCount')
  const [source, setSource] = useState<Inspection>()
  const [error, setError] = useState('')
  const [tab, setTab] = useState('context')
  const [requestId, setRequestId] = useState('')
  const [context, setContext] = useState<ContextProjectionDto>()
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(100)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setError('')
    void call('knot/inspection', { sessionId }, abort.signal).then(setSource,
      error => { if (!abort.signal.aborted) setError(String(error)) })
    return () => abort.abort()
  }, [sessionId, call, count, reload])
  const invokes = source?.events.filter(event => event.type === 'llm.invoke').map(event => ({ position: event.position, ...(event.data as any) })) ?? []
  const chosen = requestId || invokes.at(-1)?.requestId || ''
  useEffect(() => {
    const abort = new AbortController()
    setContext(undefined)
    if (tab === 'context' && chosen) void call('knot/context', { sessionId, requestId: chosen }, abort.signal).then(setContext,
      error => { if (!abort.signal.aborted) setError(String(error)) })
    return () => abort.abort()
  }, [call, sessionId, chosen, tab, reload])
  const events = source?.events.filter(event => !filter || (event.type + ' ' + JSON.stringify(event.data)).toLowerCase().includes(filter.toLowerCase())) ?? []
  return <section className="knot-inspection">
    <header><nav>{[['context', 'Context'], ['journal', 'Journal'], ['assembly', '插件 / 协议'], ['children', '子会话']].map(([id, label]) =>
      <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setError('') }}>{label}</button>)}</nav>
      <Button onClick={() => setReload(value => value + 1)}>刷新</Button></header>
    {error && <p role="alert">{error}</p>}
    {!source ? <p>读取真实 Session…</p> : <>
      {tab === 'context' && <>
        <p>来自 Journal + manifest 的真实模型输入；Token 分段数为字符估算，不是厂商分段计费。</p>
        <select aria-label="模型调用" value={chosen} onChange={e => { setRequestId(e.target.value); setError('') }}>{[...invokes].reverse().map(item =>
          <option key={item.requestId} value={item.requestId}>#{item.position} · {item.request.purpose} · {item.requestId}</option>)}</select>
        {!chosen ? <p>还没有 LLM 调用。</p> : !context ? <p>读取调用上下文…</p> : <>
          <p>输入 {context.usage?.inputTokens?.toLocaleString() ?? '未知'} tokens · Messages ~{context.estimatedMessageTokens.toLocaleString()} · Tools ~{context.estimatedToolTokens.toLocaleString()}</p>
          {context.messages.map((message, index) => <DataDetails key={chosen + ':' + index}
            title={`${index + 1}. ${message.role} · ~${message.estimatedTokens} tokens`} value={message}
            initiallyOpen={message.role === 'system' || index === context.messages.length - 1} />)}
          <DataDetails key={chosen + ':tools'} title={`本次工具 Schema · ${context.tools.length}`} value={context.tools} />
          <DataDetails key={chosen + ':manifest'} title="本次 manifest" value={context.manifest} />
        </>}
      </>}
      {tab === 'journal' && <><input aria-label="过滤 Journal" placeholder="过滤事件类型或内容" value={filter} onChange={e => { setFilter(e.target.value); setLimit(100) }} />
        <p>{events.length} 个匹配事件；显示最近 {Math.min(limit, events.length)} 个。时间来自 JSONL 元数据，不进入内核。</p>
        {events.slice(-limit).map(event => <EventRow key={event.position} event={event} />)}
        {limit < events.length && <Button onClick={() => setLimit(value => value + 100)}>显示更早的 100 个</Button>}</>}
      {tab === 'assembly' && <>
        <p>当前代码中的 Assembly 元数据（不是此历史 Session 的代码快照）。注册顺序来自可执行定义；实际历史行为请看 Journal。</p>
        {!source.assembly ? <p>Host 中没有此 Assembly 的元数据。</p> : <>
          <h3>{source.assembly.title}</h3>
          {source.assembly.plugins.map((plugin, index) => <details key={plugin.id}>
            <summary>{index + 1}. {plugin.name} · {plugin.category}</summary><p>{plugin.responsibility}</p>
            <p>订阅：<code>{plugin.listens.join(', ') || '—'}</code></p><p>输出：<code>{plugin.emits.join(', ') || '—'}</code></p><p>源码路径：<code>{plugin.source}</code></p>
          </details>)}
          <details><summary>协议 · {source.assembly.protocols.length}</summary><pre>{source.assembly.protocols.join('\n')}</pre></details>
          <details><summary>当前工具目录 · {source.assembly.tools.length}</summary>{source.assembly.tools.map(tool => <p key={tool.name}><strong>{tool.name}</strong> · {tool.description}</p>)}</details>
        </>}
      </>}
      {tab === 'children' && <>{source.children.length === 0 ? <p>没有子会话。</p> : source.children.map(child => <article key={child.id}>
        <strong>{child.title}</strong><p>{child.model ?? '模型未知'} · {child.reasoningEffort ?? '默认推理'} · {child.runState} · {child.eventCount} 事件</p>
        <code>{child.workspace}</code><p><Button onClick={() => openChild(child.id)}>查看子会话</Button></p>
      </article>)}</>}
    </>}
  </section>
}

export const inject = ['slots', 'sessions', 'uiWorkspace']
export function apply(ctx: any) {
  const call: Call = async (endpoint, input, signal = new AbortController().signal) => {
    const result = await (window as any).__DSH_TRANSPORT__.rpc.call('$knot', endpoint, { args: [input] }, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  // Client plugins activate when their services arrive, not merely in bundle order.
  const extend = (slot: string, matches: (entry: any) => boolean, install: (entry: any) => void) => {
    let installed = false
    const check = () => {
      if (installed) return
      const native = ctx.slots.entries(slot).find(matches)
      if (native) { installed = true; install(native) }
    }
    ctx.on('slots/changed', (key: string) => { if (key === slot) check() })
    check()
  }
  // Public SlotRegistry entries + shadowing: keep the original component and its hooks/styles.
  extend('conversation.composer.dock', entry => entry.options.id === 'stats', native => {
    const Original = native.component
    function Stats(props: any) {
      const events = props.useProjection('knotEventCount')
      const usage = props.useProjection('knotUsage')
      const nativeUsage = props.useProjection('tokenUsage')
      return <div className="knot-stats-inline">
        <Original {...props} t={(key: string, params: any) => key === 'stats.counts' && typeof events === 'number'
          ? props.t(key, params) + (document.documentElement.lang.startsWith('zh') ? ` ${events} 事件` : ` ${events} events`) : props.t(key, params)} />
        {usage?.knownCalls > 0 && !nativeUsage && <details><summary>{usage.totalTokens.toLocaleString()} tok{usage.knownCalls < usage.calls ? '（部分）' : ''}</summary>
          <p>输入 {usage.inputTokens.toLocaleString()} · 输出 {usage.outputTokens.toLocaleString()} · Usage {usage.knownCalls}/{usage.calls} 次</p>
          <p>历史缓存计数 {usage.cacheKnownCalls}/{usage.calls} 次；{usage.knownCacheHitRate === undefined ? '缓存未知' : '已知调用加权缓存率 ' + percent(usage.knownCacheHitRate)}</p></details>}
        {typeof usage?.latest.cacheHitRate === 'number' && !nativeUsage && <span>本次缓存 {percent(usage.latest.cacheHitRate)}</span>}
        {typeof usage?.latest.outputRate === 'number' && <span title="输出 token / invoke→generated 总时长；不是 DSH decode TPS">端到端 {usage.latest.outputRate.toFixed(1)} tok/s</span>}
      </div>
    }
    ctx.slots.register({ name: 'conversation.composer.dock', id: 'stats', order: 0, priority: -10,
      locale: native.locale, inject: native.inject }, Stats)
  })
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'knot-tasks', order: 20 }, TaskState))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'knot-inspection', order: 20,
    label: () => 'Knot Inspector', inject: (sessionId: string) => ({ call, sessionId,
      openChild: async (id: string) => { await ctx.sessions.refresh(); ctx.uiWorkspace.openSession(id) },
    }),
  }, InspectionView))
  // Same native per-tool views with a display alias only. Facts/Context keep Knot names.
  for (const [name, nativeName] of [['todo.write', 'todo_write'], ['goal.write', 'update_goal'], ['spawn_agent', 'subagent'], ['ask', 'ask_user_question']]) {
    extend('tool.call.toolview', entry => entry.options.key === nativeName, native => {
      const Original = native.component
      ctx.slots.register({ name: 'tool.call.toolview', key: name, locale: native.locale, inject: native.inject },
        (props: any) => <Original {...props} toolName={nativeName} />)
    })
  }
}
