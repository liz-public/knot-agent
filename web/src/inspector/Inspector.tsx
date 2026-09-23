import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { plugins, type PluginFixture } from '../fixtures'
import { Icon } from '../components/Icon'
import { useI18n } from '../i18n'
import type { JournalState } from '../app/types'
import { loadContextProjection, type ContextMessage, type ContextProjection, type JournalSnapshot, type ReadEvent } from '../api/workbench-api'
import { eventPreview, eventTone, formatElapsed, ownerFor } from '../run/projections'

type InspectorTab = 'trace' | 'context' | 'journal' | 'plugins'

function TracePanel({ events }: { readonly events: readonly ReadEvent[] }) {
  const { t } = useI18n(); const [filter, setFilter] = useState(''); const [selected, setSelected] = useState(events.at(-1)?.position ?? 0); const [view, setView] = useState<'model' | 'events'>('model'); const [visibleKinds, setVisibleKinds] = useState({ reasoning: true, replies: true, tools: true, users: false })
  const needle = filter.toLowerCase().trim(); const visible = needle === '' ? events : events.filter(event => `${event.type} ${eventPreview(event)} ${ownerFor(event.type)}`.toLowerCase().includes(needle)); const detail = events.find(event => event.position === selected)
  const modelCalls = events.filter(event => event.type === 'llm.generated').length; const toolCalls = events.filter(event => event.type === 'tool.call').length; const elapsed = events.reduce((sum, event) => sum + (event.elapsedMs ?? 0), 0)
  const toggle = (kind: keyof typeof visibleKinds) => setVisibleKinds(current => ({ ...current, [kind]: !current[kind] }))
  const narrative = visible.filter(event => (event.type === 'assistant.reasoning' && visibleKinds.reasoning) || (event.type === 'assistant.message' && visibleKinds.replies) || (event.type === 'tool.call' && visibleKinds.tools) || (event.type === 'tool.result' && visibleKinds.tools) || (event.type === 'user.message' && visibleKinds.users))
  return <div className="trace-panel"><div className="trace-summary"><div><strong>{events.length}</strong><span>{t('trace.facts')}</span></div><div><strong>{modelCalls}</strong><span>{t('trace.modelCalls')}</span></div><div><strong>{toolCalls}</strong><span>{t('trace.toolBatches')}</span></div><div><strong>{(elapsed / 1_000).toFixed(2)}s</strong><span>{t('trace.observed')}</span></div></div><div className="trace-view-switch"><button className={view === 'model' ? 'active' : ''} onClick={() => setView('model')}>{t('trace.modelPath')}</button><button className={view === 'events' ? 'active' : ''} onClick={() => setView('events')}>{t('trace.allEvents')}</button></div><label className="trace-search"><Icon name="search" size={13}/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder={view === 'model' ? t('trace.filterNarrative') : t('trace.filter')}/></label>{view === 'model' ? <><div className="trace-filters">{(['reasoning', 'replies', 'tools', 'users'] as const).map(kind => <button key={kind} className={visibleKinds[kind] ? 'active' : ''} onClick={() => toggle(kind)}>{t(`trace.${kind}`)}</button>)}</div><div className="model-narrative">{narrative.length === 0 ? <div className="journal-state"><strong>{t('trace.noNarrative')}</strong></div> : narrative.map(event => <NarrativeEvent event={event} key={event.position}/>)}</div></> : <><div className="trace-columns"><span>#</span><span>{t('trace.eventPayload')}</span><span>{t('trace.owner')}</span><span>{t('trace.time')}</span><span>Δ</span></div><div className="trace-list">{visible.map(event => <button className={`trace-row ${selected === event.position ? 'selected' : ''}`} key={event.position} onClick={() => setSelected(event.position)}><span className="trace-number">{String(event.position).padStart(3, '0')}</span><i className={eventTone(event.type)}/><span className="trace-main"><strong>{event.type}</strong><small>{eventPreview(event)}</small></span><code>{ownerFor(event.type)}</code><time>{event.observedAt === undefined ? '—' : new Date(event.observedAt).toLocaleTimeString([], { hour12: false })}</time><time>{formatElapsed(event.elapsedMs)}</time></button>)}</div>{detail !== undefined && <div className="trace-detail"><header><span><i className={eventTone(detail.type)}/><strong>{detail.type}</strong><code>#{detail.position}</code></span><button onClick={() => setSelected(-1)}><Icon name="close" size={13}/></button></header><p>{eventPreview(detail)}</p><pre>{JSON.stringify(detail.data, null, 2)}</pre></div>}</>}</div>
}

function NarrativeEvent({ event }: { readonly event: ReadEvent }) {
  const { t } = useI18n(); const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {}; const time = event.observedAt === undefined ? '' : new Date(event.observedAt).toLocaleTimeString([], { hour12: false })
  if (event.type === 'assistant.reasoning' || event.type === 'assistant.message' || event.type === 'user.message') {
    const label = event.type === 'assistant.reasoning' ? t('trace.reasoning') : event.type === 'assistant.message' ? t('trace.reply') : t('trace.userInput')
    return <article className={`narrative-card ${event.type.replace('.', '-')}`}><header><span>{label}</span><code>#{event.position}</code><time>{time}</time></header><div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(data['content'] ?? '')}</ReactMarkdown></div></article>
  }
  if (event.type === 'tool.call') {
    const calls = Array.isArray(data['calls']) ? data['calls'] as Array<Record<string, unknown>> : []
    return <>{calls.map((call, index) => <details className="narrative-tool" key={`${event.position}-${index}`}><summary><span>{t('trace.toolCall')}</span><strong>{String(call['name'] ?? 'tool')}</strong><code>#{event.position}</code><span className="disclosure"/></summary><pre>{JSON.stringify(call['arguments'] ?? {}, null, 2)}</pre></details>)}</>
  }
  const results = Array.isArray(data['results']) ? data['results'] as Array<Record<string, unknown>> : []
  return <>{results.map((result, index) => { const content = String(result['content'] ?? ''); let ok = true; try { const parsed = JSON.parse(content) as { ok?: unknown }; if (parsed.ok === false) ok = false } catch { /* Plain-text results have no structured failure marker. */ } return <details className="narrative-tool" key={`${event.position}-${index}`}><summary><span>{t('trace.toolResult')}</span><strong>{String(result['name'] ?? 'tool')}</strong><i className={ok ? 'success' : 'failed'}>{ok ? t('trace.success') : t('trace.failed')}</i><code>#{event.position}</code><span className="disclosure"/></summary><pre>{content}</pre></details> })}</>
}

function messageDetail(message: ContextMessage): string | undefined {
  const details = {
    ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
    ...(message.tool_call_id === undefined ? {} : { tool_call_id: message.tool_call_id }),
    ...(message.tool_calls === undefined ? {} : { tool_calls: message.tool_calls }),
  }
  return Object.keys(details).length === 0 ? undefined : JSON.stringify(details, null, 2)
}

function ContextPanel({ snapshot }: { readonly snapshot?: JournalSnapshot }) {
  const { t } = useI18n()
  const invokes = snapshot?.events.filter(event => event.type === 'llm.invoke' && typeof event.data === 'object' && event.data !== null && typeof (event.data as { requestId?: unknown }).requestId === 'string').map(event => ({
    position: event.position,
    requestId: (event.data as { requestId: string }).requestId,
    purpose: (event.data as { request?: { purpose?: string } }).request?.purpose ?? 'agent',
  })) ?? []
  const latestId = invokes.at(-1)?.requestId
  const [selected, setSelected] = useState<string | undefined>(latestId)
  const [projection, setProjection] = useState<ContextProjection>()
  const [error, setError] = useState<string>()
  useEffect(() => { if (latestId !== undefined && !invokes.some(item => item.requestId === selected)) setSelected(latestId) }, [latestId, selected, snapshot?.session.id])
  useEffect(() => {
    if (snapshot === undefined || selected === undefined) { setProjection(undefined); return }
    const controller = new AbortController(); setError(undefined)
    void loadContextProjection(snapshot.session.id, selected, controller.signal).then(setProjection, reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => controller.abort()
  }, [snapshot?.session.id, snapshot?.session.eventCount, selected])
  if (snapshot === undefined) return <div className="journal-state"><strong>{t('context.noSession')}</strong></div>
  if (invokes.length === 0) return <div className="journal-state"><strong>{t('context.noCalls')}</strong><span>{t('context.noCallsDetail')}</span></div>
  const total = (projection?.estimatedMessageTokens ?? 0) + (projection?.estimatedToolTokens ?? 0)
  return <div className="context-panel">
    <div className="context-origin"><div><strong>{t('context.modelInput')}</strong><span>{t('context.description')}</span></div><select value={selected} onChange={event => setSelected(event.target.value)}>{[...invokes].reverse().map(item => <option value={item.requestId} key={item.requestId}>#{item.position} · {item.purpose} · {item.requestId.slice(0, 16)}</option>)}</select></div>
    {error !== undefined ? <div className="journal-state error-state"><strong>{t('context.unavailable')}</strong><span>{error}</span></div> : projection === undefined ? <div className="journal-state"><i className="loading-dot"/><strong>{t('context.loading')}</strong></div> : <>
      <div className="context-usage"><div><strong>{(projection.usage?.inputTokens ?? total).toLocaleString()}</strong><span>{projection.usage?.inputTokens === undefined ? t('context.estimatedInput') : t('context.providerInput')}</span></div><div className="context-bar">{projection.messages.map((message, index) => <i key={`${message.role}-${index}`} className={`bar-${message.role}`} style={{ width: `${total === 0 ? 0 : message.estimatedTokens / total * 100}%` }}/>) }<i className="bar-tools" style={{ width: `${total === 0 ? 0 : projection.estimatedToolTokens / total * 100}%` }}/></div><footer><span>{t('context.messagesEstimate', { count: projection.estimatedMessageTokens })}</span><span>{t('context.toolsEstimate', { count: projection.estimatedToolTokens })}</span></footer></div>
      {projection.messages.map((message, index) => { const detail = messageDetail(message); return <article className="context-message" key={`${message.role}-${index}`}><header><span className={`role ${message.role}`}>{message.role}</span><code>~{message.estimatedTokens} tk</code></header>{message.content !== null && <p>{message.content}</p>}{detail !== undefined && <details><summary>{t('context.structuredFields')}</summary><pre>{detail}</pre></details>}</article> })}
      <details className="context-tools"><summary><span>{t('context.toolDefinitions')}</span><code>{projection.tools.length} · ~{projection.estimatedToolTokens} tk</code></summary>{projection.tools.length === 0 ? <p>{t('context.noTools')}</p> : projection.tools.map((tool, index) => <pre key={index}>{JSON.stringify(tool, null, 2)}</pre>)}</details>
      <details className="context-manifest"><summary>{t('context.manifest')}</summary><pre>{JSON.stringify(projection.manifest, null, 2)}</pre></details>
    </>}
  </div>
}

function JournalPanel({ state, onRefresh }: { readonly state: JournalState; readonly onRefresh: () => void }) {
  const { t } = useI18n(); const [filter, setFilter] = useState('')
  if (state.status === 'loading') return <div className="journal-state"><i className="loading-dot"/><strong>{t('journal.reading')}</strong><span>{t('journal.readOnly')}</span></div>
  if (state.status === 'error') return <div className="journal-state error-state"><strong>{t('journal.unavailable')}</strong><span>{state.message}</span><button onClick={onRefresh}>{t('journal.tryAgain')}</button></div>
  const needle = filter.trim().toLowerCase(); const events = needle === '' ? state.snapshot.events : state.snapshot.events.filter(event => `${event.type} ${JSON.stringify(event.data)}`.toLowerCase().includes(needle))
  return <div className="journal-panel"><div className="journal-toolbar"><label className="journal-search"><Icon name="search" size={14}/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder={t('journal.filter')}/></label><button onClick={onRefresh}>{t('journal.refresh')}</button></div>{events.length === 0 ? <div className="journal-state"><strong>{t('journal.noMatch')}</strong><span>{t('journal.clearFilter')}</span></div> : events.map(event => <details className="journal-event" key={event.position}><summary><span>{String(event.position).padStart(3, '0')}</span><code>{event.type}</code><small>{eventPreview(event)}</small><time>{formatElapsed(event.elapsedMs)}</time></summary><pre>{JSON.stringify({ type: event.type, data: event.data }, null, 2)}</pre></details>)}</div>
}

function PluginDetail({ plugin }: { readonly plugin: PluginFixture }) {
  const { t } = useI18n()
  return <article className="plugin-detail"><header><span className={`category ${plugin.category}`}>{plugin.category}</span><code>{plugin.version}</code></header><h3>{plugin.name}</h3><p>{plugin.description}</p><dl><div><dt>{t('plugins.listens')}</dt><dd>{plugin.listens.join(' · ') || '—'}</dd></div><div><dt>{t('plugins.emits')}</dt><dd>{plugin.emits.join(' · ') || '—'}</dd></div><div><dt>{t('plugins.protocols')}</dt><dd>{plugin.protocols.join(' · ')}</dd></div><div><dt>{t('plugins.author')}</dt><dd>{plugin.author}</dd></div></dl></article>
}

function PluginsPanel() {
  const { t } = useI18n(); const [selected, setSelected] = useState(plugins[0]!.id); const plugin = plugins.find(item => item.id === selected) ?? plugins[0]!
  return <div className="plugins-panel"><div className="blueprint-banner"><span>{t('blueprint.label')}</span><p>{t('plugins.description')}</p></div><div className="plugin-mini-list">{plugins.map((item, index) => <button key={item.id} className={selected === item.id ? 'active' : ''} onClick={() => setSelected(item.id)}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{item.name}</strong><small>{item.responsibility}</small></span><i className={item.state}/></button>)}</div><PluginDetail plugin={plugin}/></div>
}

export function Inspector({ journal, open, width, onWidth, onClose, onRefresh }: { readonly journal: JournalState; readonly open: boolean; readonly width: number; readonly onWidth: (width: number) => void; readonly onClose: () => void; readonly onRefresh: () => void }) {
  const { t } = useI18n(); const [tab, setTab] = useState<InspectorTab>('trace')
  if (!open) return null
  const snapshot = journal.status === 'ready' ? journal.snapshot : undefined
  function startResize(event: ReactPointerEvent<HTMLDivElement>) { event.currentTarget.setPointerCapture(event.pointerId); const startX = event.clientX; const startWidth = width; const move = (next: PointerEvent) => onWidth(Math.max(330, Math.min(680, startWidth + startX - next.clientX))); const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop) }
  const content = tab === 'trace' && snapshot !== undefined ? <TracePanel events={snapshot.events}/> : tab === 'context' ? <ContextPanel snapshot={snapshot}/> : tab === 'journal' ? <JournalPanel state={journal} onRefresh={onRefresh}/> : <PluginsPanel/>
  const labels: Record<InspectorTab, string> = { trace: t('inspector.trace'), context: t('inspector.context'), journal: t('inspector.journal'), plugins: t('inspector.plugins') }
  return <aside className="inspector"><div className="inspector-resizer" onPointerDown={startResize}/><div className="inspector-heading"><div><strong>{t('inspector.title')}</strong><span>{snapshot?.session.title ?? t('inspector.readModel')}</span></div><div><button className="width-button" onClick={() => onWidth(width < 520 ? 600 : 390)}>{width < 520 ? t('inspector.wide') : t('inspector.compact')}</button><button className="icon-button" onClick={onClose} aria-label={t('inspector.close')}><Icon name="close" size={15}/></button></div></div><div className="inspector-tabs">{(['trace', 'context', 'journal', 'plugins'] as const).map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{labels[item]}{item === 'plugins' && <i/>}</button>)}</div><div className="inspector-content">{content}</div><footer className="inspector-footer"><span><i/>{t('nav.facts', { count: snapshot?.session.eventCount ?? 0 })}</span><span>{tab === 'context' ? t('inspector.projectedSource') : tab === 'trace' || tab === 'journal' ? t('inspector.jsonlSource') : t('inspector.fixtureBlueprint')}</span></footer></aside>
}
