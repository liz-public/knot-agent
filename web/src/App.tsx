import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { assemblyStages, contextMessages, plugins } from './fixtures'
import {
  createSession,
  listSessions,
  loadJournalSnapshot,
  pauseSession,
  respondToInteraction,
  resumeSession,
  submitMessage,
  subscribeSession,
  type GenerationUpdate,
  type InteractionRequest,
  type JournalSnapshot,
  type ReadEvent,
  type SessionSummary,
} from './journal-api'

type Mode = 'run' | 'studio'
type InspectorTab = 'trace' | 'context' | 'journal' | 'plugins'
type JournalState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: JournalSnapshot }
  | { readonly status: 'error'; readonly message: string }
interface LiveDraft {
  readonly requestId: string
  readonly reasoning: string
  readonly content: string
  readonly toolCalls: readonly string[]
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    knot: <><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="12" cy="17" r="3"/><path d="M9.5 8.8 11 14M14.5 8.8 13 14M10 7h4"/></>,
    play: <path d="m8 5 11 7-11 7Z" />,
    studio: <><path d="M4 6h16M7 3v6M4 18h16M16 15v6"/></>,
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
    case: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 10 2 2-2 2M13 15h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 7h5a5 5 0 0 1 5 5v-3"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    pause: <><path d="M9 5v14M15 5v14"/></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    code: <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="mode-switch" aria-label="Workbench mode">
      <button className={mode === 'run' ? 'active' : ''} onClick={() => onChange('run')}><Icon name="play" size={14}/>Run</button>
      <button className={mode === 'studio' ? 'active' : ''} onClick={() => onChange('studio')}><Icon name="studio" size={14}/>Studio</button>
    </div>
  )
}

function ProjectRail({
  mode,
  onMode,
  sessions,
  selected,
  onSelect,
  onCreate,
}: {
  mode: Mode
  onMode: (mode: Mode) => void
  sessions: readonly SessionSummary[]
  selected?: string
  onSelect: (sessionId: string) => void
  onCreate: () => void
}) {
  return (
    <aside className="project-rail">
      <div className="brand"><span className="brand-mark"><Icon name="knot" size={22}/></span><span>Knot</span><span className="alpha">alpha</span></div>
      <button className="project-picker">
        <span className="project-avatar">K</span>
        <span><strong>knot-agent</strong><small>CASE2 workbench</small></span>
        <Icon name="chevron" size={14}/>
      </button>
      <div className="rail-mode"><ModeSwitch mode={mode} onChange={onMode}/></div>
      <nav className="rail-scroll">
        <div className="section-heading"><span>Sessions</span><button aria-label="New session" onClick={onCreate}><Icon name="plus" size={15}/></button></div>
        <div className="session-list">
          {sessions.map(session => (
            <button key={session.id} className={`session-row ${selected === session.id ? 'active' : ''}`} onClick={() => onSelect(session.id)}>
              <Icon name="message" size={15}/><span><strong>{session.title}</strong><small>{session.assembly.toUpperCase()} · {session.runState} · {session.eventCount} facts</small></span>{session.runState === 'running' && <i/>}
            </button>
          ))}
          {sessions.length === 0 && <span className="empty-sessions">No configured sessions</span>}
        </div>
        <div className="section-heading cases-heading"><span>Cases</span><button aria-label="New case"><Icon name="plus" size={15}/></button></div>
        <button className="nav-row"><Icon name="case" size={15}/><span>CASE2 coding task</span><b>8</b></button>
        <button className="nav-row"><Icon name="case" size={15}/><span>Guard regression</span><b>3</b></button>
      </nav>
      <div className="rail-footer"><button className="nav-row"><Icon name="settings" size={16}/><span>Project settings</span></button><div className="runtime"><span className="status-dot"/>Runtime ready <code>local</code></div></div>
    </aside>
  )
}

function WorkbenchHeader({ mode, session }: { mode: Mode; session?: SessionSummary }) {
  return (
    <header className="workbench-header">
      <div className="breadcrumb"><span>knot-agent</span><b>/</b><strong>{mode === 'run' ? session?.title ?? 'No session' : 'CASE2 assembly'}</strong></div>
      <div className="header-actions">
        <span className="branch"><Icon name="branch" size={14}/>main</span>
        <button className="model-button"><span className="model-dot"/>qwen3-coder <Icon name="chevron" size={13}/></button>
        <button className="icon-button" aria-label="More"><Icon name="more" size={17}/></button>
      </div>
    </header>
  )
}

function InteractionCard({
  interaction,
  onRespond,
}: {
  interaction: InteractionRequest
  onRespond: (interaction: InteractionRequest, value: string) => Promise<void>
}) {
  const [answer, setAnswer] = useState('')
  return <div className="interaction-card">
    <strong>{interaction.kind === 'approval' ? `Allow ${interaction.toolName}?` : interaction.question}</strong>
    {interaction.kind === 'approval' && <pre>{JSON.stringify(interaction.arguments, null, 2)}</pre>}
    {interaction.kind === 'ask' && interaction.choices === undefined && <input value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Your answer"/>}
    <div>{interaction.kind === 'approval'
      ? <><button onClick={() => void onRespond(interaction, 'deny')}>Deny</button><button className="primary" onClick={() => void onRespond(interaction, 'allow')}>Allow</button></>
      : interaction.choices === undefined
        ? <button className="primary" disabled={answer.trim().length === 0} onClick={() => void onRespond(interaction, answer.trim())}>Answer</button>
        : interaction.choices.map(choice => <button key={choice} onClick={() => void onRespond(interaction, choice)}>{choice}</button>)}</div>
  </div>
}

function RunView({
  snapshot,
  live,
  interactions,
  error,
  onSend,
  onPause,
  onResume,
  onRespond,
}: {
  snapshot?: JournalSnapshot
  live?: LiveDraft
  interactions: readonly InteractionRequest[]
  error?: string
  onSend: (content: string) => Promise<void>
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onRespond: (interaction: InteractionRequest, value: string) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [delivery, setDelivery] = useState<'steer' | 'follow_up'>('steer')
  const [queued, setQueued] = useState<string>()
  const session = snapshot?.session
  const visibleEvents = snapshot?.events.filter(event =>
    event.type === 'user.message'
    || event.type === 'assistant.reasoning'
    || event.type === 'assistant.message'
    || event.type === 'tool.call'
    || event.type === 'tool.result',
  ) ?? []
  async function send(): Promise<void> {
    const content = draft.trim()
    if (content.length === 0 || session?.writable !== true) return
    setDraft('')
    if (session.runState === 'running' && delivery === 'follow_up') {
      setQueued(content)
      return
    }
    await onSend(content)
  }
  useEffect(() => {
    if (session?.runState !== 'idle' || queued === undefined) return
    const content = queued
    setQueued(undefined)
    void onSend(content)
  }, [session?.runState, queued, onSend])
  return (
    <main className="run-view">
      <div className="conversation-scroll">
        <div className="run-intro"><span className="eyebrow">{session?.assembly.toUpperCase() ?? 'CASE2'} · {session?.writable ? 'LIVE SESSION' : 'COMPLETED SESSION'}</span><h1>{session?.title ?? 'Select a session'}</h1><p>{session?.writable ? 'Commands advance the same persistent Journal shown in the inspector.' : 'This completed Journal is available for read-only inspection.'}</p></div>
        {visibleEvents.map(event => {
          const data = event.data as Record<string, unknown>
          const time = event.observedAt === undefined ? '' : new Date(event.observedAt).toLocaleTimeString()
          if (event.type === 'user.message') return <section className="turn user-turn" key={event.position}><div className="avatar user">L</div><div><div className="message-meta"><strong>You</strong><time>{time}</time></div><p>{String(data['content'] ?? '')}</p></div></section>
          if (event.type === 'assistant.reasoning') return <section className="turn assistant-turn compact-turn" key={event.position}><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><details className="reasoning"><summary>Reasoning</summary><p>{String(data['content'] ?? '')}</p></details></div></section>
          if (event.type === 'assistant.message') return <section className="turn assistant-turn" key={event.position}><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><div className="message-meta"><strong>Knot</strong><time>{time}</time></div><p>{String(data['content'] ?? '')}</p></div></section>
          if (event.type === 'tool.call') {
            const calls = Array.isArray(data['calls']) ? data['calls'] as Array<Record<string, unknown>> : []
            return <div className="timeline-tool" key={event.position}>{calls.map(call => <div className="tool-card" key={String(call['callId'])}><div className="tool-heading"><span className="tool-icon"><Icon name="terminal" size={15}/></span><strong>{String(call['name'])}</strong><code>{JSON.stringify(call['arguments'])}</code><span className="tool-time">{formatElapsed(event.elapsedMs)}</span></div></div>)}</div>
          }
          const results = Array.isArray(data['results']) ? data['results'] as Array<Record<string, unknown>> : []
          return <div className="timeline-tool" key={event.position}>{results.map(result => <div className="tool-card result-card" key={String(result['callId'])}><div className="tool-heading"><span className="tool-icon"><Icon name="check" size={15}/></span><strong>{String(result['name'])}</strong><span className="success-pill">result</span></div><pre>{String(result['content'] ?? '')}</pre></div>)}</div>
        })}
        {live !== undefined && <section className="turn assistant-turn live-turn"><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><div className="message-meta"><strong>Knot</strong><span className="working"><i/>generating</span></div>{live.reasoning.length > 0 && <details className="reasoning" open><summary>Reasoning</summary><p>{live.reasoning}</p></details>}{live.content.length > 0 && <p>{live.content}</p>}{live.toolCalls.map((call, index) => <div className="live-tool" key={`${call}-${index}`}><Icon name="terminal" size={13}/>{call}</div>)}</div></section>}
        {interactions.map(interaction => <InteractionCard key={interaction.id} interaction={interaction} onRespond={onRespond}/>)}
        {error !== undefined && <div className="run-error">{error}</div>}
      </div>
      <div className="composer-wrap">
        <div className="context-meter"><span><i/>{session?.eventCount ?? 0} committed facts</span><span>{session?.runState ?? 'offline'}</span></div>
        <div className="composer">
          <textarea value={draft} disabled={session?.writable !== true} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={session?.writable ? 'Ask Knot to inspect or change the workspace…' : 'This session is read only'} rows={3}/>
          <div className="composer-actions"><div>{session?.runState === 'running' ? <button className="small-action" onClick={() => setDelivery(value => value === 'steer' ? 'follow_up' : 'steer')}>{delivery === 'steer' ? 'Steer now' : 'Follow up'}</button> : <button className="small-action" disabled>New turn</button>}<button className="small-action" disabled>@ Files</button></div><div>{session?.runState === 'paused' ? <button className="pause-button" onClick={() => void onResume()}><Icon name="play" size={14}/>Resume</button> : <button className="pause-button" disabled={session?.runState !== 'running'} onClick={() => void onPause()}><Icon name="pause" size={14}/>Pause</button>}<button className="send-button" disabled={draft.trim().length === 0 || session?.writable !== true} onClick={() => void send()} title={session?.runState === 'running' ? delivery === 'steer' ? 'Send steering to the active turn' : 'Queue after the current turn' : 'Start a turn'}><Icon name="send" size={15}/></button></div></div>
        </div>
        <div className="fixture-note">{queued === undefined ? session?.writable ? 'LiveOutput is transient · completed facts are committed to JSONL' : 'Read-only persisted Journal' : `Queued follow-up: ${queued}`}</div>
      </div>
    </main>
  )
}

function StudioView() {
  const [provider, setProvider] = useState<'mock' | 'real'>('real')
  return (
    <main className="studio-view">
      <div className="studio-heading"><div><span className="eyebrow">ASSEMBLY</span><h1>CASE2 coding agent</h1><p>Six responsibility boundaries composed around one Journal.</p></div><div className="studio-actions"><button>Validate</button><button className="primary"><Icon name="play" size={14}/>Run case</button></div></div>
      <section className="studio-card pipeline-card"><div className="card-heading"><div><h2>Runtime path</h2><p>Descriptive topology derived from the current assembly.</p></div><span className="healthy"><i/>6 plugins ready</span></div><div className="pipeline">{assemblyStages.map((stage, index) => <div className="stage-wrap" key={stage.label}><article className={`stage ${stage.tone}`}><span>{String(index + 1).padStart(2, '0')}</span><strong>{stage.label}</strong><small>{stage.detail}</small></article>{index < assemblyStages.length - 1 && <div className="connector"><i/></div>}</div>)}</div></section>
      <div className="studio-grid">
        <section className="studio-card"><div className="card-heading"><div><h2>Case configuration</h2><p>One controlled fixture, one selected provider.</p></div><code>case2/basic-edit</code></div><div className="field"><label>Content provider</label><div className="segmented"><button className={provider === 'mock' ? 'active' : ''} onClick={() => setProvider('mock')}>Mock</button><button className={provider === 'real' ? 'active' : ''} onClick={() => setProvider('real')}>qwen3-coder</button></div></div><div className="field"><label>Workspace</label><code>/workspace/knot-agent/.fixtures/basic-edit</code></div><div className="field"><label>Assertions</label><span>assistant.message · tool.result · tests pass</span></div></section>
        <section className="studio-card"><div className="card-heading"><div><h2>Last validation</h2><p>Mock and real use the same assembly boundaries.</p></div><span className="success-pill"><Icon name="check" size={12}/>passed</span></div><div className="metrics"><div><strong>2.12s</strong><span>duration</span></div><div><strong>2</strong><span>model calls</span></div><div><strong>1</strong><span>tool batch</span></div><div><strong>1.4k</strong><span>tokens</span></div></div><div className="comparison"><span>Journal invariants</span><strong>8 / 8</strong><div><i/></div></div></section>
      </div>
      <section className="studio-card plugin-table-card"><div className="card-heading"><div><h2>Assembly components</h2><p>Registration order is behavior; metadata remains provisional.</p></div><button className="subtle-button"><Icon name="plus" size={14}/>Add component</button></div><div className="plugin-table">{plugins.slice(0, 5).map((plugin, index) => <div className="plugin-row" key={plugin.name}><span className="order">{index + 1}</span><span><strong>{plugin.name}</strong><small>{plugin.responsibility}</small></span><code>{plugin.listens}</code><span className="arrow">→</span><code>{plugin.emits}</code><button><Icon name="chevron" size={14}/></button></div>)}</div></section>
    </main>
  )
}

function eventTone(type: string): 'neutral' | 'model' | 'tool' | 'success' {
  if (type.startsWith('llm.') || type === 'assistant.reasoning') return 'model'
  if (type.startsWith('tool.')) return 'tool'
  if (type === 'assistant.message') return 'success'
  return 'neutral'
}

function formatElapsed(value?: number): string {
  if (value === undefined) return '—'
  return value < 1_000 ? `+${value}ms` : `+${(value / 1_000).toFixed(2)}s`
}

function TracePanel({ events }: { events: readonly ReadEvent[] }) {
  return <div className="trace-list">{events.map(event => <button className="trace-row" key={event.position}><span className="trace-number">{String(event.position).padStart(3, '0')}</span><i className={eventTone(event.type)}/><span><strong>{event.type}</strong><small>{event.observedAt === undefined ? 'legacy event · no timestamp' : new Date(event.observedAt).toLocaleTimeString()}</small></span><time>{formatElapsed(event.elapsedMs)}</time></button>)}</div>
}

function ContextPanel() {
  const total = useMemo(() => contextMessages.reduce((sum, message) => sum + Number(message.tokens), 0), [])
  return <div className="context-panel"><div className="context-summary"><span>Projected request</span><strong>{total} tokens</strong></div>{contextMessages.map((message, index) => <article className="context-message" key={`${message.role}-${index}`}><header><span className={`role ${message.role}`}>{message.role}</span><code>{message.tokens} tk</code></header><p>{message.text}</p>{message.tool && <span className="context-tool">tool: {message.tool}</span>}</article>)}</div>
}

function JournalPanel({ state, onRefresh }: { state: JournalState; onRefresh: () => void }) {
  const [filter, setFilter] = useState('')
  if (state.status === 'loading') {
    return <div className="journal-state"><i className="loading-dot"/><strong>Reading Journal…</strong><span>The workbench has read-only access.</span></div>
  }
  if (state.status === 'error') {
    return <div className="journal-state error-state"><strong>Journal unavailable</strong><span>{state.message}</span><button onClick={onRefresh}>Try again</button></div>
  }

  const needle = filter.trim().toLowerCase()
  const events = needle.length === 0
    ? state.snapshot.events
    : state.snapshot.events.filter(event =>
      event.type.toLowerCase().includes(needle)
      || JSON.stringify(event.data).toLowerCase().includes(needle),
    )
  return <div className="journal-panel">
    <div className="journal-toolbar">
      <label className="journal-search"><Icon name="search" size={14}/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter type or payload"/></label>
      <button onClick={onRefresh}>Refresh</button>
    </div>
    {state.snapshot.session.eventCount === 0
      ? <div className="journal-state"><strong>Empty Journal</strong><span>The configured source contains no events.</span></div>
      : events.length === 0
        ? <div className="journal-state"><strong>No matching events</strong><span>Clear the filter to show all facts.</span></div>
        : events.map(event => <details className="journal-event" key={event.position}><summary><span>{String(event.position).padStart(3, '0')}</span><code>{event.type}</code></summary><pre>{JSON.stringify({ type: event.type, data: event.data }, null, 2)}</pre></details>)}
  </div>
}

function PluginsPanel() {
  return <div className="plugins-panel"><div className="inventory-note"><Icon name="code" size={17}/><div><strong>Runtime inventory</strong><span>Observed from the CASE2 assembly fixture.</span></div></div>{plugins.map(plugin => <article className="plugin-card" key={plugin.name}><header><span><i className={plugin.state}/><strong>{plugin.name}</strong></span><button><Icon name="chevron" size={14}/></button></header><p>{plugin.responsibility}</p><dl><div><dt>listens</dt><dd>{plugin.listens}</dd></div><div><dt>emits</dt><dd>{plugin.emits}</dd></div></dl></article>)}</div>
}

function Inspector({ journal, onRefresh }: { journal: JournalState; onRefresh: () => void }) {
  const [tab, setTab] = useState<InspectorTab>('trace')
  const snapshot = journal.status === 'ready' ? journal.snapshot : undefined
  const content = tab === 'trace' && snapshot !== undefined
    ? <TracePanel events={snapshot.events}/>
    : tab === 'journal' ? <JournalPanel state={journal} onRefresh={onRefresh}/> : null
  return (
    <aside className="inspector"><div className="inspector-heading"><div><strong>Inspector</strong><span>{snapshot?.session.title ?? 'read-only Journal'}</span></div><button className="icon-button" aria-label="Inspector options"><Icon name="more" size={16}/></button></div><div className="inspector-tabs">{(['trace', 'context', 'journal', 'plugins'] as const).map(item => <button key={item} disabled={item === 'context' || item === 'plugins'} title={item === 'context' || item === 'plugins' ? 'Deferred until a real read model exists' : `Real ${item} data`} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div><div className="inspector-content">{content}</div><footer className="inspector-footer"><span><i/>{snapshot?.session.eventCount ?? 0} facts</span><span>{snapshot?.session.runState ?? 'offline'}</span></footer></aside>
  )
}

export function App() {
  const [mode, setMode] = useState<Mode>('run')
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [selected, setSelected] = useState<string>()
  const [journal, setJournal] = useState<JournalState>({ status: 'loading' })
  const [live, setLive] = useState<LiveDraft>()
  const [interactions, setInteractions] = useState<readonly InteractionRequest[]>([])
  const [runError, setRunError] = useState<string>()
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void listSessions(controller.signal).then(
      next => {
        setSessions(next)
        setSelected(current => current !== undefined && next.some(session => session.id === current)
          ? current
          : next[0]?.id)
      },
      error => {
        if (controller.signal.aborted) return
        setJournal({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => controller.abort()
  }, [reload])
  useEffect(() => {
    if (selected === undefined) return
    const controller = new AbortController()
    setJournal({ status: 'loading' })
    void loadJournalSnapshot(selected, controller.signal).then(
      snapshot => {
        setJournal({ status: 'ready', snapshot })
        setSessions(current => current.map(session => session.id === snapshot.session.id ? snapshot.session : session))
      },
      error => {
        if (controller.signal.aborted) return
        setJournal({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => controller.abort()
  }, [selected, reload])
  const activeSession = sessions.find(session => session.id === selected)
  useEffect(() => {
    setLive(undefined)
    setInteractions([])
    setRunError(undefined)
    if (selected === undefined || activeSession?.writable !== true) return
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refreshSoon = () => {
      if (refreshTimer !== undefined) return
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined
        setReload(value => value + 1)
      }, 25)
    }
    const unsubscribe = subscribeSession(selected, event => {
      if (event.kind === 'journal.changed') {
        refreshSoon()
        return
      }
      if (event.kind === 'state.changed') {
        setSessions(current => current.map(session => session.id === selected
          ? { ...session, runState: event.runState }
          : session))
        setJournal(current => current.status === 'ready'
          ? { status: 'ready', snapshot: { ...current.snapshot, session: { ...current.snapshot.session, runState: event.runState } } }
          : current)
        if (event.runState === 'idle') {
          setLive(undefined)
          refreshSoon()
        }
        return
      }
      if (event.kind === 'generation.open') {
        setLive({ requestId: event.requestId, reasoning: '', content: '', toolCalls: [] })
        return
      }
      if (event.kind === 'generation.update') {
        setLive(current => {
          const base = current?.requestId === event.requestId
            ? current
            : { requestId: event.requestId, reasoning: '', content: '', toolCalls: [] }
          const update: GenerationUpdate = event.update
          if (update.kind === 'reasoning') return { ...base, reasoning: base.reasoning + update.text }
          if (update.kind === 'content') return { ...base, content: base.content + update.text }
          const calls = [...base.toolCalls]
          calls[update.index] = [calls[update.index], update.name, update.argumentsDelta].filter(Boolean).join(' ')
          return { ...base, toolCalls: calls }
        })
        return
      }
      if (event.kind === 'interaction.request') {
        setInteractions(current => [...current.filter(item => item.id !== event.interaction.id), event.interaction])
        return
      }
      if (event.kind === 'run.error') setRunError(event.message)
    }, () => setRunError('Live session stream disconnected; committed facts remain available.'))
    return () => {
      if (refreshTimer !== undefined) clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [selected, activeSession?.writable])

  async function command(action: () => Promise<void>): Promise<void> {
    try {
      setRunError(undefined)
      await action()
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    }
  }

  const snapshot = journal.status === 'ready' ? journal.snapshot : undefined
  return <div className="app-shell">
    <ProjectRail mode={mode} onMode={setMode} sessions={sessions} selected={selected} onSelect={setSelected} onCreate={() => void command(async () => {
      const session = await createSession()
      setSessions(current => [session, ...current])
      setSelected(session.id)
    })}/>
    <section className="center-column"><WorkbenchHeader mode={mode} session={activeSession}/>{mode === 'run' ? <RunView key={snapshot?.session.id} snapshot={snapshot} live={live} interactions={interactions} error={runError} onSend={content => command(async () => { if (selected !== undefined) await submitMessage(selected, content) })} onPause={() => command(async () => { if (selected !== undefined) await pauseSession(selected) })} onResume={() => command(async () => { if (selected !== undefined) await resumeSession(selected) })} onRespond={(interaction, value) => command(async () => { if (selected === undefined) return; await respondToInteraction(selected, interaction.id, value); setInteractions(current => current.filter(item => item.id !== interaction.id)) })}/> : <StudioView/>}</section>
    <Inspector journal={journal} onRefresh={() => setReload(value => value + 1)}/>
  </div>
}
