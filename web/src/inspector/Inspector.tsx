import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { contextMessages, plugins, type PluginFixture } from '../fixtures'
import { Icon } from '../components/Icon'
import { useI18n } from '../i18n'
import type { JournalState } from '../app/types'
import type { ReadEvent } from '../api/workbench-api'
import { eventPreview, eventTone, formatElapsed, ownerFor } from '../run/projections'

type InspectorTab = 'trace' | 'context' | 'journal' | 'plugins'

function TracePanel({ events }: { readonly events: readonly ReadEvent[] }) {
  const { t } = useI18n(); const [filter, setFilter] = useState(''); const [selected, setSelected] = useState(events.at(-1)?.position ?? 0)
  const needle = filter.toLowerCase().trim(); const visible = needle === '' ? events : events.filter(event => `${event.type} ${eventPreview(event)} ${ownerFor(event.type)}`.toLowerCase().includes(needle)); const detail = events.find(event => event.position === selected)
  const modelCalls = events.filter(event => event.type === 'llm.generated').length; const toolCalls = events.filter(event => event.type === 'tool.call').length; const elapsed = events.reduce((sum, event) => sum + (event.elapsedMs ?? 0), 0)
  return <div className="trace-panel"><div className="trace-summary"><div><strong>{events.length}</strong><span>{t('trace.facts')}</span></div><div><strong>{modelCalls}</strong><span>{t('trace.modelCalls')}</span></div><div><strong>{toolCalls}</strong><span>{t('trace.toolBatches')}</span></div><div><strong>{(elapsed / 1_000).toFixed(2)}s</strong><span>{t('trace.observed')}</span></div></div><label className="trace-search"><Icon name="search" size={13}/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder={t('trace.filter')}/></label><div className="trace-columns"><span>#</span><span>{t('trace.eventPayload')}</span><span>{t('trace.owner')}</span><span>{t('trace.time')}</span><span>Δ</span></div><div className="trace-list">{visible.map(event => <button className={`trace-row ${selected === event.position ? 'selected' : ''}`} key={event.position} onClick={() => setSelected(event.position)}><span className="trace-number">{String(event.position).padStart(3, '0')}</span><i className={eventTone(event.type)}/><span className="trace-main"><strong>{event.type}</strong><small>{eventPreview(event)}</small></span><code>{ownerFor(event.type)}</code><time>{event.observedAt === undefined ? '—' : new Date(event.observedAt).toLocaleTimeString([], { hour12: false })}</time><time>{formatElapsed(event.elapsedMs)}</time></button>)}</div>{detail !== undefined && <div className="trace-detail"><header><span><i className={eventTone(detail.type)}/><strong>{detail.type}</strong><code>#{detail.position}</code></span><button onClick={() => setSelected(-1)}><Icon name="close" size={13}/></button></header><p>{eventPreview(detail)}</p><pre>{JSON.stringify(detail.data, null, 2)}</pre></div>}</div>
}

function ContextPanel() {
  const { t } = useI18n(); const total = contextMessages.reduce((sum, message) => sum + message.tokens, 0)
  return <div className="context-panel"><div className="blueprint-banner"><span>{t('blueprint.label')}</span><p>{t('context.description')}</p></div><div className="context-usage"><div><strong>{total.toLocaleString()}</strong><span>{t('context.estimatedTokens')}</span></div><div className="context-bar">{contextMessages.map(message => <i key={message.role} className={`bar-${message.role}`} style={{ width: `${message.tokens / total * 100}%` }}/>)}</div></div>{contextMessages.map((message, index) => <article className="context-message" key={`${message.role}-${index}`}><header><span className={`role ${message.role}`}>{message.role}</span><code>{message.tokens} tk</code></header><p>{message.text}</p><footer><span>{message.source}</span>{'tool' in message && message.tool !== undefined && <span>tool: {message.tool}</span>}</footer></article>)}</div>
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
  const content = tab === 'trace' && snapshot !== undefined ? <TracePanel events={snapshot.events}/> : tab === 'context' ? <ContextPanel/> : tab === 'journal' ? <JournalPanel state={journal} onRefresh={onRefresh}/> : <PluginsPanel/>
  const labels: Record<InspectorTab, string> = { trace: t('inspector.trace'), context: t('inspector.context'), journal: t('inspector.journal'), plugins: t('inspector.plugins') }
  return <aside className="inspector"><div className="inspector-resizer" onPointerDown={startResize}/><div className="inspector-heading"><div><strong>{t('inspector.title')}</strong><span>{snapshot?.session.title ?? t('inspector.readModel')}</span></div><div><button className="width-button" onClick={() => onWidth(width < 520 ? 600 : 390)}>{width < 520 ? t('inspector.wide') : t('inspector.compact')}</button><button className="icon-button" onClick={onClose} aria-label={t('inspector.close')}><Icon name="close" size={15}/></button></div></div><div className="inspector-tabs">{(['trace', 'context', 'journal', 'plugins'] as const).map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{labels[item]}{(item === 'context' || item === 'plugins') && <i/>}</button>)}</div><div className="inspector-content">{content}</div><footer className="inspector-footer"><span><i/>{t('nav.facts', { count: snapshot?.session.eventCount ?? 0 })}</span><span>{tab === 'trace' || tab === 'journal' ? t('inspector.jsonlSource') : t('inspector.fixtureBlueprint')}</span></footer></aside>
}
