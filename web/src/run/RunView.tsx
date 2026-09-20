import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '../components/Icon'
import { useI18n } from '../i18n'
import type { InteractionRequest, JournalSnapshot } from '../api/workbench-api'
import type { LiveDraft, LiveToolCallDraft, LiveToolDraft } from '../app/types'
import { formatElapsed, goalFrom, todosFrom, usageFrom, type GoalState, type TodoItem } from './projections'

function liveToolSummary(call: LiveToolCallDraft): string {
  const path = call.argumentsPreview.match(/"path"\s*:\s*"([^"]*)/)?.[1]
  const command = call.argumentsPreview.match(/"command"\s*:\s*"([^"]*)/)?.[1]
  const subject = path ?? command
  return `${call.name ?? 'tool'}${subject === undefined ? '' : ` · ${subject.slice(0, 110)}`} · ${call.argumentChars.toLocaleString()} chars`
}

function MarkdownContent({ content, live = false }: { readonly content: string; readonly live?: boolean }) {
  return <div className={`markdown-content ${live ? 'live-markdown' : ''}`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
}

function InteractionCard({ interaction, waiting, onRespond }: { readonly interaction: InteractionRequest; readonly waiting: number; readonly onRespond: (interaction: InteractionRequest, value: string) => Promise<void> }) {
  const { t } = useI18n()
  const [answer, setAnswer] = useState(''); const [customAnswer, setCustomAnswer] = useState(false)
  const choiceClass = interaction.kind === 'ask' && interaction.choices !== undefined ? ' choice-interaction' : ''
  const answerInput = interaction.kind === 'ask' && (interaction.choices === undefined || customAnswer)
  return <div className={`interaction-card${choiceClass}`}><header><strong>{interaction.kind === 'approval' ? t('run.allowTool', { tool: interaction.toolName }) : interaction.question}</strong>{waiting > 0 && <span>{t('run.waiting', { count: waiting })}</span>}</header>{interaction.kind === 'approval' && <pre>{JSON.stringify(interaction.arguments, null, 2)}</pre>}{answerInput && <input value={answer} onChange={event => setAnswer(event.target.value)} placeholder={t('run.typeAnswer')} autoFocus={customAnswer}/>}<div>{interaction.kind === 'approval' ? <><button onClick={() => void onRespond(interaction, 'deny')}>{t('run.deny')}</button><button className="primary" onClick={() => void onRespond(interaction, 'allow')}>{t('run.allow')}</button></> : interaction.choices === undefined || customAnswer ? <button className="primary" disabled={answer.trim().length === 0} onClick={() => void onRespond(interaction, answer.trim())}>{t('run.answer')}</button> : <>{interaction.choices.map(choice => <button key={choice} onClick={() => void onRespond(interaction, choice)}>{choice}</button>)}<button className="other-choice" onClick={() => setCustomAnswer(true)}>{t('run.other')}</button></>}</div></div>
}

function TodoCard({ todos }: { readonly todos: readonly TodoItem[] }) {
  const { t } = useI18n(); const completed = todos.filter(todo => todo.status === 'completed').length
  const [open, setOpen] = useState(completed < todos.length)
  return <details className="todo-card" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><span><Icon name="check" size={14}/><strong>{t('run.todo')}</strong><b>{completed}/{todos.length}</b></span><span className="disclosure"/></summary><ol>{todos.map(todo => <li className={todo.status === 'completed' ? 'completed' : ''} key={todo.id}><i/><span>{todo.content}</span><code>{todo.status}</code></li>)}</ol></details>
}

function GoalCard({ goal }: { readonly goal: GoalState }) {
  const { t } = useI18n(); const [open, setOpen] = useState(goal.status !== 'completed')
  return <details className="todo-card goal-card" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><span><Icon name="case" size={14}/><strong>{t('run.goal')}</strong><b>{goal.status}</b></span><span className="disclosure"/></summary><div className="goal-body"><strong>{goal.objective}</strong>{goal.successCriteria.length > 0 && <ol>{goal.successCriteria.map((criterion, index) => <li key={index}><i/><span>{criterion}</span></li>)}</ol>}</div></details>
}

function ToolResult({ result, command }: { readonly result: Record<string, unknown>; readonly command?: string }) {
  const { t } = useI18n(); const raw = String(result['content'] ?? '')
  let parsed: Record<string, unknown> | undefined
  try { const value = JSON.parse(raw) as unknown; if (typeof value === 'object' && value !== null && !Array.isArray(value)) parsed = value as Record<string, unknown> } catch { /* Plain text. */ }
  if (result['name'] !== 'bash' || parsed === undefined) return <details className="tool-card result-card collapsible-tool"><summary className="tool-heading"><span className="tool-icon"><Icon name="check" size={15}/></span><strong>{String(result['name'])}</strong><span className="success-pill">{t('run.result')}</span><span className="disclosure"/></summary><pre>{raw}</pre></details>
  const exitCode = Number(parsed['exitCode'] ?? 0); const output = [String(parsed['stdout'] ?? ''), String(parsed['stderr'] ?? '')].filter(Boolean).join('\n') || t('run.noOutput')
  return <details className="terminal-card collapsible-tool"><summary><span className="terminal-lights"><i/><i/><i/></span><code>$ {command ?? 'bash'}</code><span className={exitCode === 0 ? 'terminal-ok' : 'terminal-fail'}>exit {exitCode}</span><span className="disclosure"/></summary><pre>{output}</pre></details>
}

export function RunView({ snapshot, workspace, live, liveTools, interactions, error, onSend, onPause, onResume, onRespond }: { readonly snapshot?: JournalSnapshot; readonly workspace: string; readonly live?: LiveDraft; readonly liveTools: readonly LiveToolDraft[]; readonly interactions: readonly InteractionRequest[]; readonly error?: string; readonly onSend: (content: string) => Promise<void>; readonly onPause: () => Promise<void>; readonly onResume: () => Promise<void>; readonly onRespond: (interaction: InteractionRequest, value: string) => Promise<void> }) {
  const { t } = useI18n(); const [draft, setDraft] = useState(''); const [delivery, setDelivery] = useState<'steer' | 'follow_up'>('steer'); const [queued, setQueued] = useState<string>()
  const conversationRef = useRef<HTMLDivElement>(null); const followOutput = useRef(true)
  const session = snapshot?.session; const events = snapshot?.events ?? []; const usage = usageFrom(events); const todos = todosFrom(events); const goal = goalFrom(events)
  const todoStateKey = todos.map(todo => `${todo.id}:${todo.status}:${todo.content}`).join('|'); const goalStateKey = goal === undefined ? '' : `${goal.status}:${goal.objective}:${goal.successCriteria.join('|')}`
  const visibleEvents = events.filter(event => ['user.message', 'assistant.reasoning', 'assistant.message', 'tool.call', 'tool.result'].includes(event.type))
  const commands = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'tool.call' || typeof event.data !== 'object' || event.data === null) continue
    const calls = (event.data as Record<string, unknown>)['calls']; if (!Array.isArray(calls)) continue
    for (const item of calls) { const call = item as Record<string, unknown>; const args = call['arguments'] as Record<string, unknown> | undefined; commands.set(String(call['callId']), typeof args?.['command'] === 'string' ? args['command'] : JSON.stringify(args ?? {})) }
  }
  async function send() { const content = draft.trim(); if (content.length === 0 || session?.writable !== true) return; setDraft(''); if (session.runState === 'running' && delivery === 'follow_up') { setQueued(content); return }; await onSend(content) }
  useEffect(() => { if (session?.runState !== 'idle' || queued === undefined) return; const content = queued; setQueued(undefined); void onSend(content) }, [session?.runState, queued, onSend])
  const liveOutputSize = (live?.content.length ?? 0) + (live?.reasoning.length ?? 0) + (live?.toolCalls.reduce((size, tool) => size + tool.argumentChars, 0) ?? 0) + liveTools.reduce((size, tool) => size + tool.output.length, 0)
  useLayoutEffect(() => { const element = conversationRef.current; if (element !== null && followOutput.current) element.scrollTop = element.scrollHeight }, [events.length, interactions.length, liveOutputSize, error])
  const trackScroll = () => { const element = conversationRef.current; if (element !== null) followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80 }
  const percent = usage === undefined || usage.window === 0 ? 0 : Math.min(100, usage.input / usage.window * 100)
  return <main className="run-view">
    <div className="session-strip"><div><span className={`run-state ${session?.runState ?? 'offline'}`}/><strong>{session?.runState ?? t('run.offline')}</strong><span>{t('nav.facts', { count: session?.eventCount ?? 0 })}</span></div><div className="workspace-compact" title={workspace}><Icon name="folder" size={12}/><span>main</span><b>/</b><code>{workspace}</code></div><div className="usage-compact"><span>{t('run.context')}</span><div><i style={{ width: `${percent}%` }}/></div><strong>{usage === undefined ? t('run.unknown') : `${usage.input.toLocaleString()} / ${usage.window.toLocaleString()}`}</strong></div><div className="model-metrics"><span><small>{t('run.lastOutput')}</small><strong>{usage === undefined ? '—' : `${usage.output} tk`}</strong></span><span title={t('run.outputRateHint')}><small>{t('run.outputRate')}</small><strong>{usage?.outputRate === undefined ? '—' : `${usage.outputRate.toFixed(1)} tk/s`}</strong></span></div></div>
    <div className="conversation-scroll" ref={conversationRef} onScroll={trackScroll}><div className="run-intro"><span className="eyebrow">{session?.assembly.toUpperCase() ?? 'CASE2'} · {session?.writable ? t('run.liveSession') : t('run.completedSession')}</span><h1>{session?.title ?? t('run.selectSession')}</h1><p>{session?.writable ? t('run.liveDescription') : t('run.completedDescription')}</p></div>
      {visibleEvents.map(event => { const data = event.data as Record<string, unknown>; const time = event.observedAt === undefined ? '' : new Date(event.observedAt).toLocaleTimeString()
        if (event.type === 'user.message') return <section className="turn user-turn" key={event.position}><div className="avatar user">L</div><div><div className="message-meta"><strong>{t('run.you')}</strong><time>{time}</time></div><p>{String(data['content'] ?? '')}</p></div></section>
        if (event.type === 'assistant.reasoning') return <section className="turn assistant-turn compact-turn" key={event.position}><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><details className="reasoning"><summary>{t('run.reasoning')}</summary><p>{String(data['content'] ?? '')}</p></details></div></section>
        if (event.type === 'assistant.message') return <section className="turn assistant-turn" key={event.position}><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><div className="message-meta"><strong>Knot</strong><time>{time}</time></div><MarkdownContent content={String(data['content'] ?? '')}/></div></section>
        if (event.type === 'tool.call') { const calls = Array.isArray(data['calls']) ? data['calls'] as Array<Record<string, unknown>> : []; const assistantContent = typeof data['assistantContent'] === 'string' ? data['assistantContent'].trim() : ''; return <div key={event.position}>{assistantContent.length > 0 && <section className="turn assistant-turn compact-turn"><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><div className="message-meta"><strong>Knot</strong><time>{time}</time></div><MarkdownContent content={assistantContent}/></div></section>}<div className="timeline-tool">{calls.map(call => <details className="tool-card collapsible-tool" key={String(call['callId'])}><summary className="tool-heading"><span className="tool-icon"><Icon name="terminal" size={15}/></span><strong>{String(call['name'])}</strong><code>{commands.get(String(call['callId']))}</code><span className="tool-time">{formatElapsed(event.elapsedMs)}</span><span className="disclosure"/></summary><pre>{JSON.stringify(call['arguments'] ?? {}, null, 2)}</pre></details>)}</div></div> }
        const results = Array.isArray(data['results']) ? data['results'] as Array<Record<string, unknown>> : []; return <div className="timeline-tool" key={event.position}>{results.map(result => <ToolResult key={String(result['callId'])} result={result} command={commands.get(String(result['callId']))}/>)}</div> })}
      {live !== undefined && <section className="turn assistant-turn live-turn"><div className="avatar agent"><Icon name="knot" size={16}/></div><div className="turn-body"><div className="message-meta"><strong>Knot</strong><span className="working"><i/>{t('run.generating')}</span></div>{live.reasoning.length > 0 && <details className="reasoning"><summary>{t('run.liveReasoning', { count: live.reasoning.length.toLocaleString() })}</summary><p>{live.reasoning}</p></details>}{live.content.length > 0 && <MarkdownContent content={live.content} live/>}{live.toolCalls.map((call, index) => <details className="tool-card collapsible-tool live-tool-card" key={index}><summary className="tool-heading"><span className="tool-icon"><Icon name="terminal" size={13}/></span><strong>{liveToolSummary(call)}</strong><span className="disclosure"/></summary><pre>{call.argumentsPreview}{call.argumentChars > call.argumentsPreview.length ? `\n${t('run.additionalChars', { count: call.argumentChars - call.argumentsPreview.length })}` : ''}</pre></details>)}</div></section>}
      {liveTools.map(tool => <div className="timeline-tool" key={tool.callId}><details className="terminal-card live-terminal collapsible-tool"><summary><span className="terminal-lights"><i/><i/><i/></span><code>$ {tool.command}</code><span className={tool.exitCode === undefined ? 'working' : tool.exitCode === 0 ? 'terminal-ok' : 'terminal-fail'}>{tool.exitCode === undefined ? t('run.running') : `exit ${tool.exitCode}`}</span><span className="disclosure"/></summary><pre>{tool.output || t('run.waitingOutput')}</pre></details></div>)}{error !== undefined && <div className="run-error">{error}</div>}
    </div>
    <div className="runtime-dock">{goal !== undefined && <GoalCard key={goalStateKey} goal={goal}/>} {todos.length > 0 && <TodoCard key={todoStateKey} todos={todos}/>} {interactions[0] !== undefined && <InteractionCard key={interactions[0].id} interaction={interactions[0]} waiting={Math.max(0, interactions.length - 1)} onRespond={onRespond}/>}</div>
    <div className="composer-wrap"><div className="composer"><textarea value={draft} disabled={session?.writable !== true} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); void send() }} placeholder={session?.writable ? t('run.askPlaceholder') : t('run.readOnlyPlaceholder')} aria-label={t('run.messageAria')} rows={3}/><div className="composer-actions"><div>{session?.runState === 'running' ? <button className="small-action" onClick={() => setDelivery(value => value === 'steer' ? 'follow_up' : 'steer')}>{delivery === 'steer' ? t('run.steerNow') : t('run.followUp')}</button> : <button className="small-action" disabled>{t('run.newTurn')}</button>}<button className="small-action" onClick={() => setDraft(value => `${value}@`)}>{t('run.files')}</button></div><div>{session?.runState === 'paused' ? <button className="pause-button" onClick={() => void onResume()}><Icon name="play" size={14}/>{t('run.resume')}</button> : <button className="pause-button" disabled={session?.runState !== 'running'} onClick={() => void onPause()}><Icon name="pause" size={14}/>{t('run.pause')}</button>}<button className="send-button" disabled={draft.trim().length === 0 || session?.writable !== true} onClick={() => void send()}><Icon name="send" size={15}/></button></div></div></div><div className="fixture-note">{queued === undefined ? session?.writable ? t('run.inputHint') : t('run.readOnlyJournal') : t('run.queued', { content: queued })}</div></div>
  </main>
}
