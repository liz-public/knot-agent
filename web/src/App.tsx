import { useEffect, useState, type CSSProperties } from 'react'
import {
  checkStudioAssembly, createProviderProfile, createStudioCase, createStudioProject, createSession, listProviderProfiles, listSessions,
  loadJournalSnapshot, loadStudio, pauseSession, publishStudioGeneration, respondToInteraction,
  resumeSession, runStudioCase, submitMessage, subscribeSession, subscribeSessionCatalog,
  type ApprovalMode, type GenerationUpdate, type InteractionRequest, type ProviderProfileDraft, type ProviderProfileSummary,
  type ReasoningEffort, type SessionSummary, type StudioCase, type StudioSnapshot,
} from './api/workbench-api'
import { liveArgumentPreviewLimit, type DialogKind, type JournalState, type LiveDraft, type LiveToolDraft, type Mode, type ProjectView } from './app/types'
import { Inspector } from './inspector/Inspector'
import { useI18n } from './i18n'
import { ProviderDialog } from './providers/ProviderDialog'
import { RunView } from './run/RunView'
import { workspaceFrom } from './run/projections'
import { Dialog, ProjectRail, WorkbenchHeader } from './shell/Shell'
import { StudioView } from './studio/StudioView'

export function App() {
  const { t } = useI18n()
  const loadingCase: StudioCase = { id: 'case2-coding', title: 'CASE2 coding task', summary: t('studio.loadingDetail'), projectId: 'case2', workspace: '.', prompt: '', assertions: [], createdAt: '', runCount: 0 }
  const [mode, setMode] = useState<Mode>('run'); const [sessions, setSessions] = useState<readonly SessionSummary[]>([]); const [selected, setSelected] = useState<string>(); const [studio, setStudio] = useState<StudioSnapshot>(); const [studioBusy, setStudioBusy] = useState<string>(); const [studioError, setStudioError] = useState<string>()
  const [selectedProject, setSelectedProject] = useState('case2'); const [selectedCase, setSelectedCase] = useState('case2-coding'); const [journal, setJournal] = useState<JournalState>({ status: 'loading' })
  const [live, setLive] = useState<LiveDraft>(); const [liveTools, setLiveTools] = useState<readonly LiveToolDraft[]>([]); const [interactions, setInteractions] = useState<readonly InteractionRequest[]>([]); const [runError, setRunError] = useState<string>(); const [reload, setReload] = useState(0); const [dialog, setDialog] = useState<DialogKind>(); const [inspectorOpen, setInspectorOpen] = useState(true); const [inspectorWidth, setInspectorWidth] = useState(430)
  const [providerProfiles, setProviderProfiles] = useState<readonly ProviderProfileSummary[]>([]); const [providerProfileId, setProviderProfileId] = useState('')
  const projects: readonly ProjectView[] = (studio?.projects ?? []).map(project => ({ id: project.id, name: project.title, summary: project.summary, root: project.projectRoot, assembly: project.assembly, activeGenerationId: project.activeGenerationId }))
  const currentProject = projects.find(item => item.id === selectedProject) ?? projects[0]
  const currentCase = studio?.cases.find(item => item.id === selectedCase && item.projectId === currentProject?.id)
    ?? studio?.cases.find(item => item.projectId === currentProject?.id)
    ?? loadingCase
  const visibleSessions = sessions.filter(session => (session.projectId ?? session.assembly) === currentProject?.id)
  const visibleCases = (studio?.cases ?? []).filter(item => item.projectId === currentProject?.id)

  useEffect(() => { const controller = new AbortController(); void listSessions(controller.signal).then(next => { setSessions(next); setSelected(current => current !== undefined && next.some(session => session.id === current) ? current : next[0]?.id) }, error => { if (!controller.signal.aborted) setJournal({ status: 'error', message: error instanceof Error ? error.message : String(error) }) }); return () => controller.abort() }, [reload])
  useEffect(() => subscribeSessionCatalog(() => setReload(value => value + 1)), [])
  useEffect(() => { const controller = new AbortController(); void loadStudio(controller.signal).then(next => { setStudio(next); setSelectedProject(current => next.projects.some(item => item.id === current) ? current : next.projects[0]?.id ?? current); setSelectedCase(current => next.cases.some(item => item.id === current) ? current : next.cases[0]?.id ?? current) }, error => { if (!controller.signal.aborted) setStudioError(error instanceof Error ? error.message : String(error)) }); return () => controller.abort() }, [reload])
  useEffect(() => {
    if (currentProject === undefined || sessions.length === 0) return
    setSelected(current => visibleSessions.some(session => session.id === current)
      ? current
      : (visibleSessions.find(session => session.parentSessionId === undefined && session.eventCount > 0)
          ?? visibleSessions.find(session => session.parentSessionId === undefined)
          ?? visibleSessions[0])?.id)
  }, [currentProject?.id, sessions])
  useEffect(() => {
    if (currentProject === undefined || studio === undefined) return
    setSelectedCase(current => visibleCases.some(item => item.id === current) ? current : visibleCases[0]?.id ?? '')
  }, [currentProject?.id, studio])
  useEffect(() => { const controller = new AbortController(); void listProviderProfiles(controller.signal).then(profiles => { setProviderProfiles(profiles); setProviderProfileId(current => profiles.some(profile => profile.id === current && profile.configured) ? current : profiles.find(profile => profile.isDefault && profile.configured)?.id ?? profiles.find(profile => profile.configured)?.id ?? '') }, error => { if (!controller.signal.aborted) setRunError(error instanceof Error ? error.message : String(error)) }); return () => controller.abort() }, [])
  useEffect(() => { if (selected === undefined) return; const controller = new AbortController(); setJournal(current => current.status === 'ready' && current.snapshot.session.id === selected ? current : { status: 'loading' }); void loadJournalSnapshot(selected, controller.signal).then(snapshot => { setJournal({ status: 'ready', snapshot }); setSessions(current => current.map(session => session.id === snapshot.session.id ? snapshot.session : session)) }, error => { if (!controller.signal.aborted) setJournal({ status: 'error', message: error instanceof Error ? error.message : String(error) }) }); return () => controller.abort() }, [selected, reload])
  const activeSession = visibleSessions.find(session => session.id === selected)
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
    }, () => setRunError(t('error.streamDisconnected')))
    return () => { if (refreshTimer !== undefined) clearTimeout(refreshTimer); unsubscribe() }
  }, [selected, activeSession?.writable, t])

  async function command(action: () => Promise<void>) { try { setRunError(undefined); await action() } catch (error) { setRunError(error instanceof Error ? error.message : String(error)) } }
  async function makeSession(title: string, cwd: string, profileId = providerProfileId, reasoningEffort?: ReasoningEffort, approvalMode: ApprovalMode = 'ask', projectId = currentCase.projectId) { await command(async () => { const session = await createSession({ title, cwd, projectId, ...(profileId === '' ? {} : { providerProfileId: profileId }), ...(reasoningEffort === undefined ? {} : { reasoningEffort }), approvalMode }); setSessions(current => [session, ...current]); setSelected(session.id); setMode('run'); setDialog(undefined) }) }
  async function makeProvider(input: ProviderProfileDraft) { await command(async () => { const created = await createProviderProfile(input); const profiles = await listProviderProfiles(); setProviderProfiles(profiles); setProviderProfileId(created.id) }) }
  async function studioCommand(name: string, action: () => Promise<void>) { try { setStudioBusy(name); setStudioError(undefined); await action(); setStudio(await loadStudio()); setReload(value => value + 1) } catch (error) { setStudioError(error instanceof Error ? error.message : String(error)) } finally { setStudioBusy(undefined) } }
  async function makeCase(title: string, projectId: string) { if (currentProject === undefined) return; await studioCommand('create', async () => { const item = await createStudioCase({ title, projectId, workspace: currentProject.root }); setSelectedCase(item.id); setMode('studio'); setDialog(undefined) }) }
  async function makeProject(name: string, root: string, assemblyId: string) { await studioCommand('project', async () => { const item = await createStudioProject({ title: name, projectRoot: root, assemblyId }); setSelectedProject(item.id); setDialog(undefined) }) }
  const checkAssembly = () => { void studioCommand('check', async () => { await checkStudioAssembly(currentCase.id) }) }
  const publishGeneration = () => { void studioCommand('publish', async () => { await publishStudioGeneration(currentCase.id) }) }
  const runCase = (runMode: 'mock' | 'real') => { void studioCommand(runMode, async () => { await runStudioCase({ caseId: currentCase.id, mode: runMode, ...(runMode === 'real' && providerProfileId !== '' ? { providerProfileId } : {}) }) }) }

  const snapshot = journal.status === 'ready' ? journal.snapshot : undefined
  const workspace = activeSession?.workspace ?? workspaceFrom(snapshot?.events ?? [], currentCase.workspace)
  const activeModel = activeSession?.model ?? providerProfiles.find(profile => profile.id === providerProfileId)?.model ?? t('dialog.noProvider')
  const shellStyle = { '--inspector-width': `${inspectorOpen ? inspectorWidth : 0}px` } as CSSProperties
  if (currentProject === undefined) return <main className="studio-view"><div className="journal-state"><i className="loading-dot"/><strong>{t('studio.loading')}</strong><span>{t('studio.loadingDetail')}</span></div></main>
  return <div className={`app-shell ${inspectorOpen ? '' : 'inspector-closed'}`} style={shellStyle}>
    <ProjectRail mode={mode} project={currentProject} sessions={visibleSessions} selectedSession={selected} selectedCase={selectedCase} cases={visibleCases} onMode={setMode} onSelectSession={id => { setSelected(id); setMode('run') }} onSelectCase={id => { setSelectedCase(id); setMode('studio') }} onDialog={setDialog}/>
    <section className="center-column"><WorkbenchHeader mode={mode} project={currentProject} session={activeSession} currentCase={currentCase} workspace={workspace} model={activeModel} inspectorOpen={inspectorOpen} onModel={() => setDialog('session-model')} onSettings={() => setDialog('settings')} onInspector={() => setInspectorOpen(true)}/>{mode === 'run' ? <RunView key={snapshot?.session.id} snapshot={snapshot} workspace={workspace} live={live} liveTools={liveTools} interactions={interactions} error={runError} onSend={content => command(async () => { if (selected !== undefined) await submitMessage(selected, content) })} onPause={() => command(async () => { if (selected !== undefined) await pauseSession(selected) })} onResume={() => command(async () => { if (selected !== undefined) await resumeSession(selected) })} onRespond={(interaction, value) => command(async () => { if (selected === undefined) return; await respondToInteraction(selected, interaction.id, value); setInteractions(current => current.filter(item => item.id !== interaction.id)) })}/> : <StudioView studio={studio} currentCase={currentCase} busy={studioBusy} error={studioError} onCheck={checkAssembly} onRun={runCase} onPublish={publishGeneration} onOpenSession={sessionId => { setSelected(sessionId); setMode('run'); setReload(value => value + 1) }}/>}</section>
    <Inspector journal={journal} open={inspectorOpen} width={inspectorWidth} onWidth={setInspectorWidth} onClose={() => setInspectorOpen(false)} onRefresh={() => setReload(value => value + 1)}/>
    {(dialog === 'session-model' || dialog === 'providers') && <ProviderDialog
      mode={dialog} profiles={providerProfiles} session={activeSession} onClose={() => setDialog(undefined)}
      onManage={() => setDialog('providers')}
      reload={() => listProviderProfiles()}
      onChanged={profiles => {
        setProviderProfiles(profiles)
        setProviderProfileId(current => profiles.some(profile => profile.id === current && profile.configured)
          ? current
          : profiles.find(profile => profile.isDefault && profile.configured)?.id ?? profiles.find(profile => profile.configured)?.id ?? '')
      }}
    />}
    {dialog !== undefined && dialog !== 'session-model' && dialog !== 'providers' && <Dialog
      kind={dialog} project={currentProject} projects={projects} currentCase={currentCase}
      providerProfiles={providerProfiles} providerProfileId={providerProfileId} assemblies={studio?.projects.map(item => item.assembly) ?? []}
      onProviderProfile={setProviderProfileId} onClose={() => setDialog(undefined)}
      onCreateSession={(title, cwd, profileId, reasoningEffort, approvalMode, projectId) => void makeSession(title, cwd, profileId, reasoningEffort, approvalMode, projectId)}
      onCreateProvider={input => { void makeProvider(input) }}
      onCreateCase={(title, projectId) => { void makeCase(title, projectId) }} onCreateProject={(name, root, assemblyId) => { void makeProject(name, root, assemblyId) }}
      onSelectProject={id => { setSelectedProject(id); setSelectedCase(studio?.cases.find(item => item.projectId === id)?.id ?? ''); setSelected(sessions.find(item => (item.projectId ?? item.assembly) === id)?.id); setDialog(undefined) }}
    />}
  </div>
}
