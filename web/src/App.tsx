import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { assemblyStages, contextMessages, plugins } from './fixtures'
import {
  listSessions,
  loadJournalSnapshot,
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
}: {
  mode: Mode
  onMode: (mode: Mode) => void
  sessions: readonly SessionSummary[]
  selected?: string
  onSelect: (sessionId: string) => void
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
        <div className="section-heading"><span>Sessions</span><button aria-label="New session"><Icon name="plus" size={15}/></button></div>
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

function ToolCard() {
  return (
    <div className="tool-card">
      <div className="tool-heading"><span className="tool-icon"><Icon name="terminal" size={15}/></span><strong>bash</strong><code>npm test</code><span className="tool-time">517ms</span><span className="success-pill"><Icon name="check" size={12}/>exit 0</span></div>
      <pre>tests 48 · pass 48 · fail 0{`\n`}duration 414ms</pre>
    </div>
  )
}

function RunView() {
  const [draft, setDraft] = useState('')
  return (
    <main className="run-view">
      <div className="conversation-scroll">
        <div className="run-intro"><span className="eyebrow">CASE2 · READ-ONLY WORKBENCH</span><h1>Refactor auth boundary</h1><p>A fixture-backed run surface beside a real CASE2 Journal snapshot.</p></div>
        <section className="turn user-turn"><div className="avatar user">L</div><div><div className="message-meta"><strong>You</strong><time>10:42</time></div><p>Run the tests, identify the failure, and make the smallest safe correction.</p></div></section>
        <section className="turn assistant-turn"><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><div className="message-meta"><strong>Knot</strong><time>10:42</time><span className="working"><i/>worked for 2.1s</span></div><details className="reasoning"><summary>Reasoning <span>3 steps</span></summary><p>I will inspect the failing assertion, compare it with the Journal delivery contract, and avoid changing unrelated runtime code.</p></details><p>I found that the fixture expected the pre-guard event count. The runtime behavior is correct; I updated only the case assertion and reran the suite.</p><ToolCard/><div className="result-note"><Icon name="check" size={15}/><span>All 48 tests pass. No runtime files changed.</span></div></div></section>
      </div>
      <div className="composer-wrap">
        <div className="context-meter"><span><i/>Context 8.4k / 32k</span><span>26%</span></div>
        <div className="composer">
          <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask Knot to inspect or change the workspace…" rows={3}/>
          <div className="composer-actions"><div><button className="small-action">+ Context</button><button className="small-action">@ Files</button></div><div><button className="pause-button"><Icon name="pause" size={14}/>Pause</button><button className="send-button" disabled={draft.trim().length === 0} title="Runtime connection is not part of Phase 1"><Icon name="send" size={15}/></button></div></div>
        </div>
        <div className="fixture-note">Run surface is static · Journal inspector is connected read-only</div>
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
  return <div className="app-shell"><ProjectRail mode={mode} onMode={setMode} sessions={sessions} selected={selected} onSelect={setSelected}/><section className="center-column"><WorkbenchHeader mode={mode} session={activeSession}/>{mode === 'run' ? <RunView/> : <StudioView/>}</section><Inspector journal={journal} onRefresh={() => setReload(value => value + 1)}/></div>
}
