import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cases as caseFixtures, contextMessages, plugins, protocols, sequence, type CaseFixture, type PluginFixture } from './fixtures'
import {
  createSession,
  listProviderProfiles,
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
  type ProviderProfileSummary,
  type ReadEvent,
  type SessionSummary,
} from './journal-api'

type Mode = 'run' | 'studio'
type InspectorTab = 'trace' | 'context' | 'journal' | 'plugins'
type DialogKind = 'new-session' | 'new-case' | 'projects' | 'settings' | 'plugin-library'
type JournalState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: JournalSnapshot }
  | { readonly status: 'error'; readonly message: string }

interface LiveDraft {
  readonly requestId: string
  readonly reasoning: string
  readonly content: string
  readonly toolCalls: readonly LiveToolCallDraft[]
}

interface LiveToolCallDraft {
  readonly name?: string
  readonly argumentsPreview: string
  readonly argumentChars: number
}

interface LiveToolDraft {
  readonly callId: string
  readonly toolName: string
  readonly command: string
  readonly output: string
  readonly exitCode?: number
}

interface UsageSummary {
  readonly input: number
  readonly output: number
  readonly total: number
  readonly window: number
  readonly outputRate?: number
}

interface TodoItem {
  readonly id: string
  readonly content: string
  readonly status: string
}

const liveArgumentPreviewLimit = 4_096

interface ProjectFixture {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly root: string
}

const initialProjects: readonly ProjectFixture[] = [
  { id: 'knot-agent', name: 'knot-agent', summary: 'Agent workbench', root: '/Users/lizhe/workspace/knot-agent' },
  { id: 'android-agent', name: 'Android agent lab', summary: 'Imported blueprint', root: '/Users/lizhe/AndroidStudioProjects/lz-refactor' },
]

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    knot: <><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="12" cy="17" r="3"/><path d="M9.5 8.8 11 14M14.5 8.8 13 14M10 7h4"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>,
    studio: <><path d="M4 6h16M7 3v6M4 18h16M16 15v6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    down: <path d="m6 9 6 6 6-6"/>,
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>,
    case: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 10 2 2-2 2M13 15h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 7h5a5 5 0 0 1 5 5V9"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    pause: <><path d="M9 5v14M15 5v14"/></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    code: <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
    folder: <path d="M3 7h7l2 2h9v10H3Z"/>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
    activity: <path d="M3 12h4l2-7 4 14 2-7h6"/>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function formatElapsed(value?: number): string {
  if (value === undefined) return '—'
  return value < 1_000 ? `+${value}ms` : `+${(value / 1_000).toFixed(2)}s`
}

function eventTone(type: string): 'neutral' | 'model' | 'tool' | 'success' {
  if (type.startsWith('llm.') || type === 'assistant.reasoning') return 'model'
  if (type.startsWith('tool.')) return 'tool'
  if (type === 'assistant.message') return 'success'
  return 'neutral'
}

function ownerFor(type: string): string {
  if (type === 'user.message') return 'Input'
  if (type === 'context.dynamic') return 'WorkspaceContext'
  if (type === 'content.request') return 'CodingFlow'
  if (type === 'llm.request') return 'ContentSources'
  if (type === 'llm.invoke') return 'ContextAssembler'
  if (type.startsWith('llm.') || type === 'assistant.reasoning') return 'LLMProvider'
  if (type.startsWith('tool.')) return 'Tools'
  if (type === 'assistant.message') return 'Output'
  if (type === 'system.prompt') return 'SystemPrompt'
  return 'Runtime'
}

function eventPreview(event: ReadEvent): string {
  const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {}
  if (typeof data['content'] === 'string') return data['content']
  if (typeof data['query'] === 'string') return data['query']
  if (typeof data['purpose'] === 'string') return data['purpose']
  if (Array.isArray(data['calls'])) return data['calls'].map(item => String((item as Record<string, unknown>)['name'] ?? 'tool')).join(', ')
  if (Array.isArray(data['results'])) return data['results'].map(item => String((item as Record<string, unknown>)['name'] ?? 'result')).join(', ')
  if (data['usage'] !== undefined) return 'generation complete · usage recorded'
  return Object.keys(data).slice(0, 4).join(' · ') || 'empty payload'
}

function usageFrom(events: readonly ReadEvent[]): UsageSummary | undefined {
  const generated = [...events].reverse().find(event => event.type === 'llm.generated')
  if (generated === undefined || typeof generated.data !== 'object' || generated.data === null) return undefined
  const usage = (generated.data as Record<string, unknown>)['usage']
  if (typeof usage !== 'object' || usage === null) return undefined
  const value = usage as Record<string, unknown>
  const input = Number(value['inputTokens'])
  const output = Number(value['outputTokens'])
  const total = Number(value['totalTokens'])
  const window = Number(value['contextWindow'])
  if (![input, output, total, window].every(Number.isFinite)) return undefined
  const requestId = (generated.data as Record<string, unknown>)['requestId']
  const invoke = typeof requestId === 'string'
    ? [...events].reverse().find(event => event.type === 'llm.invoke'
      && typeof event.data === 'object'
      && event.data !== null
      && (event.data as Record<string, unknown>)['requestId'] === requestId)
    : undefined
  const startedAt = invoke?.observedAt === undefined ? Number.NaN : Date.parse(invoke.observedAt)
  const completedAt = generated.observedAt === undefined ? Number.NaN : Date.parse(generated.observedAt)
  const durationSeconds = (completedAt - startedAt) / 1_000
  const outputRate = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? output / durationSeconds
    : undefined
  return { input, output, total, window, ...(outputRate === undefined ? {} : { outputRate }) }
}

function todosFrom(events: readonly ReadEvent[]): readonly TodoItem[] {
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const event = events[eventIndex]
    if (event?.type !== 'tool.result' || typeof event.data !== 'object' || event.data === null) continue
    const results = (event.data as Record<string, unknown>)['results']
    if (!Array.isArray(results)) continue
    for (let resultIndex = results.length - 1; resultIndex >= 0; resultIndex -= 1) {
      const result = results[resultIndex]
      if (typeof result !== 'object' || result === null) continue
      const state = (result as Record<string, unknown>)['state']
      if (typeof state !== 'object' || state === null) continue
      const record = state as Record<string, unknown>
      if (record['key'] !== 'todo' || !Array.isArray(record['value'])) continue
      return record['value'].flatMap((item, index) => {
        if (typeof item !== 'object' || item === null) return []
        const candidate = item as Record<string, unknown>
        if (typeof candidate['content'] !== 'string' || typeof candidate['status'] !== 'string') return []
        return [{
          id: typeof candidate['id'] === 'string' ? candidate['id'] : String(index + 1),
          content: candidate['content'],
          status: candidate['status'],
        }]
      })
    }
  }
  return []
}

function liveToolSummary(call: LiveToolCallDraft): string {
  const path = call.argumentsPreview.match(/"path"\s*:\s*"([^"]*)/)?.[1]
  const command = call.argumentsPreview.match(/"command"\s*:\s*"([^"]*)/)?.[1]
  const subject = path ?? command
  const detail = subject === undefined ? '' : ` · ${subject.slice(0, 110)}`
  return `${call.name ?? 'tool'}${detail} · ${call.argumentChars.toLocaleString()} chars`
}

function workspaceFrom(events: readonly ReadEvent[], fallback: string): string {
  const context = [...events].reverse().find(event => event.type === 'context.dynamic')
  if (context === undefined || typeof context.data !== 'object' || context.data === null) return fallback
  const content = (context.data as Record<string, unknown>)['content']
  if (typeof content !== 'string') return fallback
  return content.match(/Current workspace:\s*(.+)/)?.[1] ?? fallback
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return <div className="mode-switch" aria-label="Workbench mode"><button className={mode === 'run' ? 'active' : ''} onClick={() => onChange('run')}><Icon name="play" size={14}/>Run</button><button className={mode === 'studio' ? 'active' : ''} onClick={() => onChange('studio')}><Icon name="studio" size={14}/>Studio</button></div>
}

function ProjectRail({ mode, project, sessions, selectedSession, selectedCase, cases, onMode, onSelectSession, onSelectCase, onDialog }: {
  mode: Mode
  project: ProjectFixture
  sessions: readonly SessionSummary[]
  selectedSession?: string
  selectedCase: string
  cases: readonly CaseFixture[]
  onMode: (mode: Mode) => void
  onSelectSession: (id: string) => void
  onSelectCase: (id: string) => void
  onDialog: (kind: DialogKind) => void
}) {
  return <aside className="project-rail">
    <div className="brand"><span className="brand-mark"><Icon name="knot" size={22}/></span><span>Knot</span><span className="alpha">alpha</span></div>
    <button className="project-picker" onClick={() => onDialog('projects')}><span className="project-avatar">{project.name.slice(0, 1).toUpperCase()}</span><span><strong>{project.name}</strong><small>{project.summary}</small></span><Icon name="down" size={13}/></button>
    <div className="rail-mode"><ModeSwitch mode={mode} onChange={onMode}/></div>
    <nav className="rail-scroll">
      <div className="section-heading"><span>Sessions</span><button aria-label="New session" onClick={() => onDialog('new-session')}><Icon name="plus" size={15}/></button></div>
      <div className="session-list">{sessions.map(session => <button key={session.id} className={`session-row ${selectedSession === session.id && mode === 'run' ? 'active' : ''}`} onClick={() => onSelectSession(session.id)}><Icon name="message" size={15}/><span><strong>{session.title}</strong><small>{session.assembly.toUpperCase()} · {session.runState} · {session.eventCount} facts</small></span>{session.runState === 'running' && <i/>}</button>)}{sessions.length === 0 && <span className="empty-sessions">No configured sessions</span>}</div>
      <div className="section-heading cases-heading"><span>Cases</span><button aria-label="New case" onClick={() => onDialog('new-case')}><Icon name="plus" size={15}/></button></div>
      {cases.map(item => <button key={item.id} className={`nav-row ${selectedCase === item.id && mode === 'studio' ? 'active' : ''}`} onClick={() => onSelectCase(item.id)}><Icon name="case" size={15}/><span>{item.title}</span><b>{item.runs}</b></button>)}
    </nav>
    <div className="rail-footer"><button className="nav-row" onClick={() => onDialog('settings')}><Icon name="settings" size={16}/><span>Project settings</span></button><div className="runtime"><span className="status-dot"/>Runtime ready <code>local</code></div></div>
  </aside>
}

function WorkbenchHeader({ mode, project, session, currentCase, workspace, model, inspectorOpen, onModel, onSettings, onInspector }: {
  mode: Mode
  project: ProjectFixture
  session?: SessionSummary
  currentCase: CaseFixture
  workspace: string
  model: string
  inspectorOpen: boolean
  onModel: () => void
  onSettings: () => void
  onInspector: () => void
}) {
  return <header className="workbench-header">
    <div className="breadcrumb"><span>{project.name}</span><b>/</b><strong>{mode === 'run' ? session?.title ?? 'No session' : currentCase.title}</strong></div>
    <div className="header-actions"><button className="path-button" onClick={onSettings} title={workspace}><Icon name="folder" size={14}/><span>{workspace.split('/').filter(Boolean).at(-1) ?? workspace}</span></button><span className="branch"><Icon name="branch" size={14}/>main</span><button className="model-button" onClick={onModel}><span className="model-dot"/>{model}<Icon name="down" size={12}/></button>{!inspectorOpen && <button className="icon-button framed" onClick={onInspector} title="Open inspector"><Icon name="panel" size={16}/></button>}</div>
  </header>
}

function InteractionCard({ interaction, waiting, onRespond }: { interaction: InteractionRequest; waiting: number; onRespond: (interaction: InteractionRequest, value: string) => Promise<void> }) {
  const [answer, setAnswer] = useState('')
  const choiceClass = interaction.kind === 'ask' && interaction.choices !== undefined ? ' choice-interaction' : ''
  return <div className={`interaction-card${choiceClass}`}><header><strong>{interaction.kind === 'approval' ? `Allow ${interaction.toolName}?` : interaction.question}</strong>{waiting > 0 && <span>{waiting} waiting</span>}</header>{interaction.kind === 'approval' && <pre>{JSON.stringify(interaction.arguments, null, 2)}</pre>}{interaction.kind === 'ask' && interaction.choices === undefined && <input value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Your answer"/>}<div>{interaction.kind === 'approval' ? <><button onClick={() => void onRespond(interaction, 'deny')}>Deny</button><button className="primary" onClick={() => void onRespond(interaction, 'allow')}>Allow</button></> : interaction.choices === undefined ? <button className="primary" disabled={answer.trim().length === 0} onClick={() => void onRespond(interaction, answer.trim())}>Answer</button> : interaction.choices.map(choice => <button key={choice} onClick={() => void onRespond(interaction, choice)}>{choice}</button>)}</div></div>
}

function TodoCard({ todos }: { todos: readonly TodoItem[] }) {
  const completed = todos.filter(todo => todo.status === 'completed').length
  const [open, setOpen] = useState(completed < todos.length)
  return <details className="todo-card" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><span><Icon name="check" size={14}/><strong>Todo</strong><b>{completed}/{todos.length}</b></span><span className="disclosure"/></summary><ol>{todos.map(todo => <li className={todo.status === 'completed' ? 'completed' : ''} key={todo.id}><i/><span>{todo.content}</span><code>{todo.status}</code></li>)}</ol></details>
}

function MarkdownContent({ content, live = false }: { content: string; live?: boolean }) {
  return <div className={`markdown-content ${live ? 'live-markdown' : ''}`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
}

function ToolResult({ result, command }: { result: Record<string, unknown>; command?: string }) {
  const raw = String(result['content'] ?? '')
  let parsed: Record<string, unknown> | undefined
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) parsed = value as Record<string, unknown>
  } catch { /* Plain-text tool results remain plain text. */ }
  const isTerminal = result['name'] === 'bash' && parsed !== undefined
  if (!isTerminal) return <details className="tool-card result-card collapsible-tool"><summary className="tool-heading"><span className="tool-icon"><Icon name="check" size={15}/></span><strong>{String(result['name'])}</strong><span className="success-pill">result</span><span className="disclosure"/></summary><pre>{raw}</pre></details>
  const exitCode = Number(parsed?.['exitCode'] ?? 0)
  const output = [String(parsed?.['stdout'] ?? ''), String(parsed?.['stderr'] ?? '')].filter(Boolean).join('\n') || '(no output)'
  return <details className="terminal-card collapsible-tool"><summary><span className="terminal-lights"><i/><i/><i/></span><code>$ {command ?? 'bash'}</code><span className={exitCode === 0 ? 'terminal-ok' : 'terminal-fail'}>exit {exitCode}</span><span className="disclosure"/></summary><pre>{output}</pre></details>
}

function RunView({ snapshot, workspace, live, liveTools, interactions, error, onSend, onPause, onResume, onRespond }: {
  snapshot?: JournalSnapshot
  workspace: string
  live?: LiveDraft
  liveTools: readonly LiveToolDraft[]
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
  const conversationRef = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  const session = snapshot?.session
  const events = snapshot?.events ?? []
  const usage = usageFrom(events)
  const todos = todosFrom(events)
  const todoStateKey = todos.map(todo => `${todo.id}:${todo.status}:${todo.content}`).join('|')
  const visibleEvents = events.filter(event => ['user.message', 'assistant.reasoning', 'assistant.message', 'tool.call', 'tool.result'].includes(event.type))
  const commands = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'tool.call' || typeof event.data !== 'object' || event.data === null) continue
    const calls = (event.data as Record<string, unknown>)['calls']
    if (!Array.isArray(calls)) continue
    for (const item of calls) {
      const call = item as Record<string, unknown>
      const args = call['arguments'] as Record<string, unknown> | undefined
      commands.set(String(call['callId']), typeof args?.['command'] === 'string' ? args['command'] : JSON.stringify(args ?? {}))
    }
  }
  async function send(): Promise<void> {
    const content = draft.trim()
    if (content.length === 0 || session?.writable !== true) return
    setDraft('')
    if (session.runState === 'running' && delivery === 'follow_up') { setQueued(content); return }
    await onSend(content)
  }
  useEffect(() => {
    if (session?.runState !== 'idle' || queued === undefined) return
    const content = queued
    setQueued(undefined)
    void onSend(content)
  }, [session?.runState, queued, onSend])
  const liveOutputSize = (live?.content.length ?? 0)
    + (live?.reasoning.length ?? 0)
    + (live?.toolCalls.reduce((size, tool) => size + tool.argumentChars, 0) ?? 0)
    + liveTools.reduce((size, tool) => size + tool.output.length, 0)
  useLayoutEffect(() => {
    const element = conversationRef.current
    if (element !== null && followOutput.current) element.scrollTop = element.scrollHeight
  }, [events.length, interactions.length, liveOutputSize, error])
  function trackScroll(): void {
    const element = conversationRef.current
    if (element === null) return
    followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
  }
  const percent = usage === undefined || usage.window === 0 ? 0 : Math.min(100, usage.input / usage.window * 100)
  return <main className="run-view">
    <div className="session-strip"><div><span className={`run-state ${session?.runState ?? 'offline'}`}/><strong>{session?.runState ?? 'offline'}</strong><span>{session?.eventCount ?? 0} facts</span></div><div className="workspace-compact" title={workspace}><Icon name="folder" size={12}/><span>main</span><b>/</b><code>{workspace}</code></div><div className="usage-compact"><span>Context</span><div><i style={{ width: `${percent}%` }}/></div><strong>{usage === undefined ? 'unknown' : `${usage.input.toLocaleString()} / ${usage.window.toLocaleString()}`}</strong></div><div className="model-metrics"><span><small>Last output</small><strong>{usage === undefined ? '—' : `${usage.output} tk`}</strong></span><span title="Output tokens divided by llm.invoke → llm.generated elapsed time"><small>Output rate</small><strong>{usage?.outputRate === undefined ? '—' : `${usage.outputRate.toFixed(1)} tk/s`}</strong></span></div></div>
    <div className="conversation-scroll" ref={conversationRef} onScroll={trackScroll}><div className="run-intro"><span className="eyebrow">{session?.assembly.toUpperCase() ?? 'CASE2'} · {session?.writable ? 'LIVE SESSION' : 'COMPLETED SESSION'}</span><h1>{session?.title ?? 'Select a session'}</h1><p>{session?.writable ? 'Commands advance the persistent Journal shown in the inspector.' : 'This completed Journal is available for read-only inspection.'}</p></div>
      {visibleEvents.map(event => {
        const data = event.data as Record<string, unknown>
        const time = event.observedAt === undefined ? '' : new Date(event.observedAt).toLocaleTimeString()
        if (event.type === 'user.message') return <section className="turn user-turn" key={event.position}><div className="avatar user">L</div><div><div className="message-meta"><strong>You</strong><time>{time}</time></div><p>{String(data['content'] ?? '')}</p></div></section>
        if (event.type === 'assistant.reasoning') return <section className="turn assistant-turn compact-turn" key={event.position}><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><details className="reasoning"><summary>Reasoning</summary><p>{String(data['content'] ?? '')}</p></details></div></section>
        if (event.type === 'assistant.message') return <section className="turn assistant-turn" key={event.position}><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><div className="message-meta"><strong>Knot</strong><time>{time}</time></div><MarkdownContent content={String(data['content'] ?? '')}/></div></section>
        if (event.type === 'tool.call') {
          const calls = Array.isArray(data['calls']) ? data['calls'] as Array<Record<string, unknown>> : []
          return <div className="timeline-tool" key={event.position}>{calls.map(call => <details className="tool-card collapsible-tool" key={String(call['callId'])}><summary className="tool-heading"><span className="tool-icon"><Icon name="terminal" size={15}/></span><strong>{String(call['name'])}</strong><code>{commands.get(String(call['callId']))}</code><span className="tool-time">{formatElapsed(event.elapsedMs)}</span><span className="disclosure"/></summary><pre>{JSON.stringify(call['arguments'] ?? {}, null, 2)}</pre></details>)}</div>
        }
        const results = Array.isArray(data['results']) ? data['results'] as Array<Record<string, unknown>> : []
        return <div className="timeline-tool" key={event.position}>{results.map(result => <ToolResult key={String(result['callId'])} result={result} command={commands.get(String(result['callId']))}/>)}</div>
      })}
      {live !== undefined && <section className="turn assistant-turn live-turn"><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><div className="message-meta"><strong>Knot</strong><span className="working"><i/>generating</span></div>{live.reasoning.length > 0 && <details className="reasoning"><summary>Reasoning · live · {live.reasoning.length.toLocaleString()} chars</summary><p>{live.reasoning}</p></details>}{live.content.length > 0 && <MarkdownContent content={live.content} live/>}{live.toolCalls.map((call, index) => <details className="tool-card collapsible-tool live-tool-card" key={index}><summary className="tool-heading"><span className="tool-icon"><Icon name="terminal" size={13}/></span><strong>{liveToolSummary(call)}</strong><span className="disclosure"/></summary><pre>{call.argumentsPreview}{call.argumentChars > call.argumentsPreview.length ? `\n… ${call.argumentChars - call.argumentsPreview.length} additional chars not rendered` : ''}</pre></details>)}</div></section>}
      {liveTools.map(tool => <div className="timeline-tool" key={tool.callId}><details className="terminal-card live-terminal collapsible-tool"><summary><span className="terminal-lights"><i/><i/><i/></span><code>$ {tool.command}</code><span className={tool.exitCode === undefined ? 'working' : tool.exitCode === 0 ? 'terminal-ok' : 'terminal-fail'}>{tool.exitCode === undefined ? 'running' : `exit ${tool.exitCode}`}</span><span className="disclosure"/></summary><pre>{tool.output || '(waiting for output)'}</pre></details></div>)}
      {error !== undefined && <div className="run-error">{error}</div>}
    </div>
    <div className="runtime-dock">{todos.length > 0 && <TodoCard key={todoStateKey} todos={todos}/>} {interactions[0] !== undefined && <InteractionCard key={interactions[0].id} interaction={interactions[0]} waiting={Math.max(0, interactions.length - 1)} onRespond={onRespond}/>}</div>
    <div className="composer-wrap"><div className="composer"><textarea value={draft} disabled={session?.writable !== true} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={session?.writable ? 'Ask Knot to inspect or change the workspace…' : 'This session is read only'} rows={3}/><div className="composer-actions"><div>{session?.runState === 'running' ? <button className="small-action" onClick={() => setDelivery(value => value === 'steer' ? 'follow_up' : 'steer')}>{delivery === 'steer' ? 'Steer now' : 'Follow up'}</button> : <button className="small-action" disabled>New turn</button>}<button className="small-action" onClick={() => setDraft(value => `${value}@`)}>@ Files</button></div><div>{session?.runState === 'paused' ? <button className="pause-button" onClick={() => void onResume()}><Icon name="play" size={14}/>Resume</button> : <button className="pause-button" disabled={session?.runState !== 'running'} onClick={() => void onPause()}><Icon name="pause" size={14}/>Pause</button>}<button className="send-button" disabled={draft.trim().length === 0 || session?.writable !== true} onClick={() => void send()}><Icon name="send" size={15}/></button></div></div></div><div className="fixture-note">{queued === undefined ? session?.writable ? 'LiveOutput is transient · completed facts are committed to JSONL' : 'Read-only persisted Journal' : `Queued follow-up: ${queued}`}</div></div>
  </main>
}

function TracePanel({ events }: { events: readonly ReadEvent[] }) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<number>(events.at(-1)?.position ?? 0)
  const needle = filter.toLowerCase().trim()
  const visible = needle === '' ? events : events.filter(event => `${event.type} ${eventPreview(event)} ${ownerFor(event.type)}`.toLowerCase().includes(needle))
  const detail = events.find(event => event.position === selected)
  const modelCalls = events.filter(event => event.type === 'llm.generated').length
  const toolCalls = events.filter(event => event.type === 'tool.call').length
  const elapsed = events.reduce((sum, event) => sum + (event.elapsedMs ?? 0), 0)
  return <div className="trace-panel"><div className="trace-summary"><div><strong>{events.length}</strong><span>facts</span></div><div><strong>{modelCalls}</strong><span>model calls</span></div><div><strong>{toolCalls}</strong><span>tool batches</span></div><div><strong>{(elapsed / 1_000).toFixed(2)}s</strong><span>observed</span></div></div><label className="trace-search"><Icon name="search" size={13}/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter event, owner or payload"/></label><div className="trace-columns"><span>#</span><span>Event / payload</span><span>Owner</span><span>Time</span><span>Δ</span></div><div className="trace-list">{visible.map(event => <button className={`trace-row ${selected === event.position ? 'selected' : ''}`} key={event.position} onClick={() => setSelected(event.position)}><span className="trace-number">{String(event.position).padStart(3, '0')}</span><i className={eventTone(event.type)}/><span className="trace-main"><strong>{event.type}</strong><small>{eventPreview(event)}</small></span><code>{ownerFor(event.type)}</code><time>{event.observedAt === undefined ? '—' : new Date(event.observedAt).toLocaleTimeString([], { hour12: false })}</time><time>{formatElapsed(event.elapsedMs)}</time></button>)}</div>{detail !== undefined && <div className="trace-detail"><header><span><i className={eventTone(detail.type)}/><strong>{detail.type}</strong><code>#{detail.position}</code></span><button onClick={() => setSelected(-1)}><Icon name="close" size={13}/></button></header><p>{eventPreview(detail)}</p><pre>{JSON.stringify(detail.data, null, 2)}</pre></div>}</div>
}

function ContextPanel() {
  const total = contextMessages.reduce((sum, message) => sum + message.tokens, 0)
  return <div className="context-panel"><div className="blueprint-banner"><span>Blueprint</span><p>Projected request shape. Real request capture stays deferred until provider diagnostics require it.</p></div><div className="context-usage"><div><strong>{total.toLocaleString()}</strong><span>estimated tokens</span></div><div className="context-bar">{contextMessages.map(message => <i key={message.role} className={`bar-${message.role}`} style={{ width: `${message.tokens / total * 100}%` }}/>)}</div></div>{contextMessages.map((message, index) => <article className="context-message" key={`${message.role}-${index}`}><header><span className={`role ${message.role}`}>{message.role}</span><code>{message.tokens} tk</code></header><p>{message.text}</p><footer><span>{message.source}</span>{'tool' in message && message.tool !== undefined && <span>tool: {message.tool}</span>}</footer></article>)}</div>
}

function JournalPanel({ state, onRefresh }: { state: JournalState; onRefresh: () => void }) {
  const [filter, setFilter] = useState('')
  if (state.status === 'loading') return <div className="journal-state"><i className="loading-dot"/><strong>Reading Journal…</strong><span>The workbench has read-only access.</span></div>
  if (state.status === 'error') return <div className="journal-state error-state"><strong>Journal unavailable</strong><span>{state.message}</span><button onClick={onRefresh}>Try again</button></div>
  const needle = filter.trim().toLowerCase()
  const events = needle === '' ? state.snapshot.events : state.snapshot.events.filter(event => `${event.type} ${JSON.stringify(event.data)}`.toLowerCase().includes(needle))
  return <div className="journal-panel"><div className="journal-toolbar"><label className="journal-search"><Icon name="search" size={14}/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter type or payload"/></label><button onClick={onRefresh}>Refresh</button></div>{events.length === 0 ? <div className="journal-state"><strong>No matching events</strong><span>Clear the filter to show all facts.</span></div> : events.map(event => <details className="journal-event" key={event.position}><summary><span>{String(event.position).padStart(3, '0')}</span><code>{event.type}</code><small>{eventPreview(event)}</small><time>{formatElapsed(event.elapsedMs)}</time></summary><pre>{JSON.stringify({ type: event.type, data: event.data }, null, 2)}</pre></details>)}</div>
}

function PluginsPanel() {
  const [selected, setSelected] = useState(plugins[0]!.id)
  const plugin = plugins.find(item => item.id === selected) ?? plugins[0]!
  return <div className="plugins-panel"><div className="blueprint-banner"><span>Blueprint</span><p>Assembly metadata fixture. It defines the future read-model contract.</p></div><div className="plugin-mini-list">{plugins.map((item, index) => <button key={item.id} className={selected === item.id ? 'active' : ''} onClick={() => setSelected(item.id)}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{item.name}</strong><small>{item.responsibility}</small></span><i className={item.state}/></button>)}</div><PluginDetail plugin={plugin}/></div>
}

function PluginDetail({ plugin }: { plugin: PluginFixture }) {
  return <article className="plugin-detail"><header><span className={`category ${plugin.category}`}>{plugin.category}</span><code>{plugin.version}</code></header><h3>{plugin.name}</h3><p>{plugin.description}</p><dl><div><dt>Listens</dt><dd>{plugin.listens.join(' · ') || '—'}</dd></div><div><dt>Emits</dt><dd>{plugin.emits.join(' · ') || '—'}</dd></div><div><dt>Protocols</dt><dd>{plugin.protocols.join(' · ')}</dd></div><div><dt>Author</dt><dd>{plugin.author}</dd></div></dl></article>
}

function Inspector({ journal, open, width, onWidth, onClose, onRefresh }: { journal: JournalState; open: boolean; width: number; onWidth: (width: number) => void; onClose: () => void; onRefresh: () => void }) {
  const [tab, setTab] = useState<InspectorTab>('trace')
  if (!open) return null
  const snapshot = journal.status === 'ready' ? journal.snapshot : undefined
  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = width
    const move = (next: PointerEvent) => onWidth(Math.max(330, Math.min(680, startWidth + startX - next.clientX)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const content = tab === 'trace' && snapshot !== undefined ? <TracePanel events={snapshot.events}/> : tab === 'context' ? <ContextPanel/> : tab === 'journal' ? <JournalPanel state={journal} onRefresh={onRefresh}/> : <PluginsPanel/>
  return <aside className="inspector"><div className="inspector-resizer" onPointerDown={startResize}/><div className="inspector-heading"><div><strong>Inspector</strong><span>{snapshot?.session.title ?? 'Journal read model'}</span></div><div><button className="width-button" onClick={() => onWidth(width < 520 ? 600 : 390)}>{width < 520 ? 'Wide' : 'Compact'}</button><button className="icon-button" onClick={onClose} aria-label="Close inspector"><Icon name="close" size={15}/></button></div></div><div className="inspector-tabs">{(['trace', 'context', 'journal', 'plugins'] as const).map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}{(item === 'context' || item === 'plugins') && <i/>}</button>)}</div><div className="inspector-content">{content}</div><footer className="inspector-footer"><span><i/>{snapshot?.session.eventCount ?? 0} facts</span><span>{tab === 'trace' || tab === 'journal' ? 'JSONL source' : 'fixture blueprint'}</span></footer></aside>
}

function StudioView({ currentCase, provider, onProvider, validation, onValidate, onRun, onAddPlugin }: { currentCase: CaseFixture; provider: 'mock' | 'real'; onProvider: (value: 'mock' | 'real') => void; validation: 'idle' | 'running' | 'passed'; onValidate: () => void; onRun: () => void; onAddPlugin: () => void }) {
  const [section, setSection] = useState<'topology' | 'sequence' | 'protocols'>('topology')
  const [selectedPlugin, setSelectedPlugin] = useState(plugins[5]!.id)
  const plugin = plugins.find(item => item.id === selectedPlugin) ?? plugins[5]!
  return <main className="studio-view"><div className="studio-heading"><div><span className="eyebrow">AGENT ASSEMBLY · BLUEPRINT</span><h1>{currentCase.title}</h1><p>{currentCase.summary}</p></div><div className="studio-actions"><button onClick={onValidate}>{validation === 'running' ? 'Validating…' : validation === 'passed' ? <><Icon name="check" size={14}/>Validated</> : 'Validate'}</button><button className="primary" onClick={onRun}><Icon name="play" size={14}/>Run case</button></div></div>
    <div className="studio-tabs"><button className={section === 'topology' ? 'active' : ''} onClick={() => setSection('topology')}>Assembly</button><button className={section === 'sequence' ? 'active' : ''} onClick={() => setSection('sequence')}>Interaction sequence</button><button className={section === 'protocols' ? 'active' : ''} onClick={() => setSection('protocols')}>Protocol catalog</button></div>
    {section === 'topology' && <><section className="studio-card assembly-map"><div className="card-heading"><div><h2>Registration order</h2><p>Every component is an ordinary Journal plugin; order is explicit assembly behavior.</p></div><span className="healthy"><i/>{plugins.length} components</span></div><div className="plugin-lanes">{(['platform', 'context', 'flow', 'content', 'effect', 'presentation'] as const).map(category => <div className="plugin-lane" key={category}><span>{category}</span><div>{plugins.filter(item => item.category === category).map((item, index) => <button key={item.id} className={selectedPlugin === item.id ? 'active' : ''} onClick={() => setSelectedPlugin(item.id)}><b>{plugins.indexOf(item) + 1}</b><strong>{item.name}</strong><small>{item.listens.join(' · ')}</small>{index < plugins.filter(candidate => candidate.category === category).length - 1 && <i/>}</button>)}</div></div>)}</div></section><div className="studio-detail-grid"><section className="studio-card plugin-table-card"><div className="card-heading"><div><h2>Assembly components</h2><p>Select a component to inspect its stable responsibility and protocols.</p></div><button className="subtle-button" onClick={onAddPlugin}><Icon name="plus" size={14}/>Add component</button></div><div className="plugin-table">{plugins.map((item, index) => <button className={`plugin-row ${selectedPlugin === item.id ? 'active' : ''}`} key={item.id} onClick={() => setSelectedPlugin(item.id)}><span className="order">{index + 1}</span><span><strong>{item.name}</strong><small>{item.responsibility}</small></span><span className={`category ${item.category}`}>{item.category}</span><code>{item.listens.join(' · ')}</code><span className="arrow">→</span><code>{item.emits.join(' · ') || '—'}</code></button>)}</div></section><section className="studio-card sticky-detail"><PluginDetail plugin={plugin}/><div className="contract-note"><Icon name="code" size={16}/><span><strong>Metadata contract candidate</strong><small>ID, version, author, responsibility and protocol declarations stay descriptive until frozen by later cases.</small></span></div></section></div></>}
    {section === 'sequence' && <section className="studio-card sequence-card"><div className="card-heading"><div><h2>One complete coding turn</h2><p>An interactive fixture of the event path; it is the acceptance target for a future assembly read model.</p></div><span className="blueprint-pill">fixture</span></div><div className="sequence-head"><span>Producer</span><span>Journal event</span><span>Consumer</span><span>Meaning</span></div><div className="sequence-list">{sequence.map((step, index) => <button key={`${step.event}-${index}`}><b>{String(index + 1).padStart(2, '0')}</b><strong>{step.from}</strong><span><i/>→ <code>{step.event}</code> →<i/></span><strong>{step.to}</strong><small>{step.note}</small></button>)}</div></section>}
    {section === 'protocols' && <section className="studio-card protocol-card"><div className="card-heading"><div><h2>Protocol catalog</h2><p>The vocabulary that lets plugins collaborate without naming one another.</p></div><span className="blueprint-pill">{protocols.length} contracts</span></div><div className="protocol-table"><header><span>Protocol</span><span>Kind</span><span>Purpose</span><span>Producer → consumers</span><span>Fields</span></header>{protocols.map(item => <article key={item.name}><code>{item.name}</code><span className={`protocol-kind ${item.kind}`}>{item.kind}</span><p>{item.summary}</p><span><strong>{item.producer}</strong><i>→</i>{item.consumers}</span><code>{item.fields}</code></article>)}</div></section>}
    <div className="studio-bottom-grid"><section className="studio-card"><div className="card-heading"><div><h2>Case configuration</h2><p>Fixture configuration; Run creates a real CASE2 session.</p></div><code>{currentCase.assembly}</code></div><div className="field"><label>Content provider</label><div className="segmented"><button className={provider === 'mock' ? 'active' : ''} onClick={() => onProvider('mock')}>Mock</button><button className={provider === 'real' ? 'active' : ''} onClick={() => onProvider('real')}>Real model</button></div></div><div className="field"><label>Workspace</label><code>{currentCase.workspace}</code></div><div className="field"><label>Assertions</label><span>{currentCase.assertions.join(' · ')}</span></div></section><section className="studio-card"><div className="card-heading"><div><h2>Last validation</h2><p>Mock and real providers share the same assembly boundaries.</p></div><span className="success-pill"><Icon name="check" size={12}/>{validation === 'passed' ? 'passed now' : 'passed'}</span></div><div className="metrics"><div><strong>2.12s</strong><span>duration</span></div><div><strong>2</strong><span>model calls</span></div><div><strong>1</strong><span>tool batch</span></div><div><strong>1.4k</strong><span>tokens</span></div></div></section></div>
  </main>
}

function Dialog({ kind, project, projects, currentCase, providerProfiles, providerProfileId, onClose, onCreateSession, onCreateCase, onCreateProject, onSelectProject, onProviderProfile }: { kind: DialogKind; project: ProjectFixture; projects: readonly ProjectFixture[]; currentCase: CaseFixture; providerProfiles: readonly ProviderProfileSummary[]; providerProfileId: string; onClose: () => void; onCreateSession: (title: string, cwd: string, providerProfileId: string) => void; onCreateCase: (title: string) => void; onCreateProject: (name: string, root: string) => void; onSelectProject: (id: string) => void; onProviderProfile: (providerProfileId: string) => void }) {
  const [title, setTitle] = useState(kind === 'new-session' ? `${currentCase.title} run` : kind === 'projects' ? 'Untitled agent project' : 'Untitled case')
  const [cwd, setCwd] = useState(kind === 'projects' ? '/Users/lizhe/workspace' : currentCase.workspace)
  const providerSelect = <label>Provider profile<select value={providerProfileId} onChange={event => onProviderProfile(event.target.value)}>{providerProfiles.map(profile => <option key={profile.id} value={profile.id} disabled={!profile.configured}>{profile.label}{profile.configured ? '' : ' · not configured'}</option>)}</select></label>
  const selectedProvider = providerProfiles.find(profile => profile.id === providerProfileId)
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="dialog"><header><div><span className="eyebrow">{kind === 'settings' || kind === 'projects' ? 'PROJECT' : kind === 'plugin-library' ? 'STUDIO' : 'CREATE'}</span><h2>{kind === 'new-session' ? 'New CASE2 session' : kind === 'new-case' ? 'New simulation case' : kind === 'projects' ? 'Projects' : kind === 'settings' ? 'Project settings' : 'Component library'}</h2></div><button className="icon-button" onClick={onClose}><Icon name="close" size={16}/></button></header>{kind === 'new-session' && <><label>Session title<input value={title} onChange={event => setTitle(event.target.value)}/></label><label>Working directory<input value={cwd} onChange={event => setCwd(event.target.value)}/></label>{providerSelect}<div className="dialog-summary"><span>Assembly</span><strong>CASE2 coding agent</strong><span>Model</span><strong>{selectedProvider?.model ?? 'No configured provider'}</strong></div><footer><button onClick={onClose}>Cancel</button><button className="primary" disabled={title.trim() === '' || cwd.trim() === '' || selectedProvider?.configured !== true} onClick={() => onCreateSession(title.trim(), cwd.trim(), providerProfileId)}>Create session</button></footer></>}{kind === 'new-case' && <><label>Case name<input value={title} onChange={event => setTitle(event.target.value)}/></label><p className="dialog-copy">Creates a local blueprint by copying the current CASE2 assembly. Persistence will be connected after the project format is frozen.</p><footer><button onClick={onClose}>Cancel</button><button className="primary" disabled={title.trim() === ''} onClick={() => onCreateCase(title.trim())}>Create fixture</button></footer></>}{kind === 'projects' && <><div className="project-list">{projects.map(item => <button key={item.id} className={item.id === project.id ? 'active' : ''} onClick={() => onSelectProject(item.id)}><span className="project-avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.root}</small></span>{item.id === project.id && <Icon name="check" size={14}/>}</button>)}</div><div className="dialog-divider"><span>New fixture project</span></div><label>Project name<input value={title} onChange={event => setTitle(event.target.value)}/></label><label>Workspace root<input value={cwd} onChange={event => setCwd(event.target.value)}/></label><footer><button onClick={onClose}>Cancel</button><button className="primary" disabled={title.trim() === '' || cwd.trim() === ''} onClick={() => onCreateProject(title.trim(), cwd.trim())}>Create project</button></footer></>}{kind === 'settings' && <><div className="settings-list"><div><span>Project root</span><code>{project.root}</code></div><div><span>Runtime</span><strong>Local Node.js · connected</strong></div><div><span>Storage</span><strong>Append-only JSONL</strong></div><div><span>Default case</span><strong>{currentCase.title}</strong></div></div>{providerSelect}<footer><button className="primary" onClick={onClose}>Done</button></footer></>}{kind === 'plugin-library' && <><div className="library-grid">{plugins.slice(2, 8).map(plugin => <button key={plugin.id} onClick={onClose}><span className={`category ${plugin.category}`}>{plugin.category}</span><strong>{plugin.name}</strong><small>{plugin.responsibility}</small><i>Already assembled</i></button>)}</div><p className="dialog-copy">Dynamic installation is intentionally a UI fixture until plugin identity, metadata and runtime mutation semantics are frozen.</p></>}</section></div>
}

export function App() {
  const [mode, setMode] = useState<Mode>('run')
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [selected, setSelected] = useState<string>()
  const [caseItems, setCaseItems] = useState<readonly CaseFixture[]>(caseFixtures)
  const [projects, setProjects] = useState<readonly ProjectFixture[]>(initialProjects)
  const [selectedProject, setSelectedProject] = useState(initialProjects[0]!.id)
  const [selectedCase, setSelectedCase] = useState(caseFixtures[0]!.id)
  const [journal, setJournal] = useState<JournalState>({ status: 'loading' })
  const [live, setLive] = useState<LiveDraft>()
  const [liveTools, setLiveTools] = useState<readonly LiveToolDraft[]>([])
  const [interactions, setInteractions] = useState<readonly InteractionRequest[]>([])
  const [runError, setRunError] = useState<string>()
  const [reload, setReload] = useState(0)
  const [dialog, setDialog] = useState<DialogKind>()
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [inspectorWidth, setInspectorWidth] = useState(430)
  const [providerProfiles, setProviderProfiles] = useState<readonly ProviderProfileSummary[]>([])
  const [providerProfileId, setProviderProfileId] = useState('')
  const [provider, setProvider] = useState<'mock' | 'real'>('real')
  const [validation, setValidation] = useState<'idle' | 'running' | 'passed'>('idle')
  const currentCase = caseItems.find(item => item.id === selectedCase) ?? caseItems[0]!
  const currentProject = projects.find(item => item.id === selectedProject) ?? projects[0]!

  useEffect(() => {
    const controller = new AbortController()
    void listSessions(controller.signal).then(next => { setSessions(next); setSelected(current => current !== undefined && next.some(session => session.id === current) ? current : next[0]?.id) }, error => { if (!controller.signal.aborted) setJournal({ status: 'error', message: error instanceof Error ? error.message : String(error) }) })
    return () => controller.abort()
  }, [reload])
  useEffect(() => {
    const controller = new AbortController()
    void listProviderProfiles(controller.signal).then(profiles => {
      setProviderProfiles(profiles)
      setProviderProfileId(current => profiles.some(profile => profile.id === current && profile.configured)
        ? current
        : profiles.find(profile => profile.configured)?.id ?? '')
    }, error => { if (!controller.signal.aborted) setRunError(error instanceof Error ? error.message : String(error)) })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (selected === undefined) return
    const controller = new AbortController()
    setJournal(current => current.status === 'ready' && current.snapshot.session.id === selected
      ? current
      : { status: 'loading' })
    void loadJournalSnapshot(selected, controller.signal).then(snapshot => { setJournal({ status: 'ready', snapshot }); setSessions(current => current.map(session => session.id === snapshot.session.id ? snapshot.session : session)) }, error => { if (!controller.signal.aborted) setJournal({ status: 'error', message: error instanceof Error ? error.message : String(error) }) })
    return () => controller.abort()
  }, [selected, reload])
  const activeSession = sessions.find(session => session.id === selected)
  useEffect(() => {
    setLive(undefined); setLiveTools([]); setInteractions([]); setRunError(undefined)
    if (selected === undefined || activeSession?.writable !== true) return
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refreshSoon = () => { if (refreshTimer === undefined) refreshTimer = setTimeout(() => { refreshTimer = undefined; setReload(value => value + 1) }, 25) }
    const unsubscribe = subscribeSession(selected, event => {
      if (event.kind === 'journal.changed') { setLiveTools(current => current.filter(tool => tool.exitCode === undefined)); refreshSoon(); return }
      if (event.kind === 'state.changed') { setSessions(current => current.map(session => session.id === selected ? { ...session, runState: event.runState } : session)); setJournal(current => current.status === 'ready' ? { status: 'ready', snapshot: { ...current.snapshot, session: { ...current.snapshot.session, runState: event.runState } } } : current); if (event.runState === 'idle') { setLive(undefined); refreshSoon() }; return }
      if (event.kind === 'generation.open') { setLive({ requestId: event.requestId, reasoning: '', content: '', toolCalls: [] }); return }
      if (event.kind === 'generation.update') { setLive(current => { const base = current?.requestId === event.requestId ? current : { requestId: event.requestId, reasoning: '', content: '', toolCalls: [] }; const update: GenerationUpdate = event.update; if (update.kind === 'reasoning') return { ...base, reasoning: base.reasoning + update.text }; if (update.kind === 'content') return { ...base, content: base.content + update.text }; const calls = [...base.toolCalls]; const previous = calls[update.index] ?? { argumentsPreview: '', argumentChars: 0 }; const delta = update.argumentsDelta ?? ''; calls[update.index] = { name: previous.name ?? update.name, argumentsPreview: `${previous.argumentsPreview}${delta}`.slice(0, liveArgumentPreviewLimit), argumentChars: previous.argumentChars + delta.length }; return { ...base, toolCalls: calls } }); return }
      if (event.kind === 'tool.open') { setLiveTools(current => [...current.filter(tool => tool.callId !== event.callId), { callId: event.callId, toolName: event.toolName, command: event.command, output: '' }]); return }
      if (event.kind === 'tool.update') { setLiveTools(current => current.map(tool => tool.callId === event.callId ? { ...tool, output: tool.output + event.update.text } : tool)); return }
      if (event.kind === 'tool.close') { setLiveTools(current => current.map(tool => tool.callId === event.callId ? { ...tool, exitCode: event.exitCode } : tool)); return }
      if (event.kind === 'interaction.request') { setInteractions(current => [...current.filter(item => item.id !== event.interaction.id), event.interaction]); return }
      if (event.kind === 'run.error') setRunError(event.message)
    }, () => setRunError('Live session stream disconnected; committed facts remain available.'))
    return () => { if (refreshTimer !== undefined) clearTimeout(refreshTimer); unsubscribe() }
  }, [selected, activeSession?.writable])

  async function command(action: () => Promise<void>): Promise<void> {
    try { setRunError(undefined); await action() } catch (error) { setRunError(error instanceof Error ? error.message : String(error)) }
  }
  async function makeSession(title: string, cwd: string, profileId = providerProfileId): Promise<void> {
    await command(async () => { const session = await createSession({ title, cwd, ...(profileId === '' ? {} : { providerProfileId: profileId }) }); setSessions(current => [session, ...current]); setSelected(session.id); setMode('run'); setDialog(undefined) })
  }
  function makeCase(title: string): void {
    const item: CaseFixture = { ...currentCase, id: `fixture-${Date.now()}`, title, runs: 0, provider: 'mock', providerLabel: 'mock provider' }
    setCaseItems(current => [...current, item]); setSelectedCase(item.id); setMode('studio'); setDialog(undefined)
  }
  function makeProject(name: string, root: string): void {
    const item: ProjectFixture = { id: `fixture-${Date.now()}`, name, summary: 'Local fixture project', root }
    setProjects(current => [...current, item]); setSelectedProject(item.id); setDialog(undefined)
  }
  function validate(): void { setValidation('running'); window.setTimeout(() => setValidation('passed'), 700) }

  const snapshot = journal.status === 'ready' ? journal.snapshot : undefined
  const workspace = activeSession?.workspace
    ?? workspaceFrom(snapshot?.events ?? [], currentCase.workspace)
  const activeModel = activeSession?.model
    ?? providerProfiles.find(profile => profile.id === providerProfileId)?.model
    ?? 'No provider'
  const shellStyle = { '--inspector-width': `${inspectorOpen ? inspectorWidth : 0}px` } as CSSProperties
  return <div className={`app-shell ${inspectorOpen ? '' : 'inspector-closed'}`} style={shellStyle}>
    <ProjectRail mode={mode} project={currentProject} sessions={sessions} selectedSession={selected} selectedCase={selectedCase} cases={caseItems} onMode={setMode} onSelectSession={id => { setSelected(id); setMode('run') }} onSelectCase={id => { setSelectedCase(id); setMode('studio') }} onDialog={setDialog}/>
    <section className="center-column"><WorkbenchHeader mode={mode} project={currentProject} session={activeSession} currentCase={currentCase} workspace={workspace} model={activeModel} inspectorOpen={inspectorOpen} onModel={() => setDialog('settings')} onSettings={() => setDialog('settings')} onInspector={() => setInspectorOpen(true)}/>{mode === 'run' ? <RunView key={snapshot?.session.id} snapshot={snapshot} workspace={workspace} live={live} liveTools={liveTools} interactions={interactions} error={runError} onSend={content => command(async () => { if (selected !== undefined) await submitMessage(selected, content) })} onPause={() => command(async () => { if (selected !== undefined) await pauseSession(selected) })} onResume={() => command(async () => { if (selected !== undefined) await resumeSession(selected) })} onRespond={(interaction, value) => command(async () => { if (selected === undefined) return; await respondToInteraction(selected, interaction.id, value); setInteractions(current => current.filter(item => item.id !== interaction.id)) })}/> : <StudioView currentCase={currentCase} provider={provider} onProvider={setProvider} validation={validation} onValidate={validate} onRun={() => void makeSession(`${currentCase.title} run`, currentCase.workspace)} onAddPlugin={() => setDialog('plugin-library')}/>}</section>
    <Inspector journal={journal} open={inspectorOpen} width={inspectorWidth} onWidth={setInspectorWidth} onClose={() => setInspectorOpen(false)} onRefresh={() => setReload(value => value + 1)}/>
    {dialog !== undefined && <Dialog
      kind={dialog}
      project={currentProject}
      projects={projects}
      currentCase={currentCase}
      providerProfiles={providerProfiles}
      providerProfileId={providerProfileId}
      onProviderProfile={setProviderProfileId}
      onClose={() => setDialog(undefined)}
      onCreateSession={(title, cwd, profileId) => void makeSession(title, cwd, profileId)}
      onCreateCase={makeCase}
      onCreateProject={makeProject}
      onSelectProject={id => { setSelectedProject(id); setDialog(undefined) }}
    />}
  </div>
}
