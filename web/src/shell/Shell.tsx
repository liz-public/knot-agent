import { useEffect, useState } from 'react'
import { plugins } from '../fixtures'
import { Icon } from '../components/Icon'
import { useI18n } from '../i18n'
import type { ApprovalMode, ProviderProfileSummary, ReasoningEffort, SessionSummary, StudioCase } from '../api/workbench-api'
import type { DialogKind, Mode, ProjectFixture } from '../app/types'

function ModeSwitch({ mode, onChange }: { readonly mode: Mode; readonly onChange: (mode: Mode) => void }) {
  const { t } = useI18n()
  return <div className="mode-switch" aria-label={t('mode.aria')}><button className={mode === 'run' ? 'active' : ''} onClick={() => onChange('run')}><Icon name="play" size={14}/>{t('mode.run')}</button><button className={mode === 'studio' ? 'active' : ''} onClick={() => onChange('studio')}><Icon name="studio" size={14}/>{t('mode.studio')}</button></div>
}

function sessionTreeOrder(sessions: readonly SessionSummary[]): readonly SessionSummary[] {
  const ids = new Set(sessions.map(session => session.id))
  const children = new Map<string, SessionSummary[]>()
  const roots: SessionSummary[] = []
  for (const session of sessions) {
    if (session.parentSessionId === undefined || !ids.has(session.parentSessionId)) roots.push(session)
    else children.set(session.parentSessionId, [...(children.get(session.parentSessionId) ?? []), session])
  }
  const ordered: SessionSummary[] = []
  const seen = new Set<string>()
  const append = (session: SessionSummary) => {
    if (seen.has(session.id)) return
    seen.add(session.id); ordered.push(session)
    for (const child of children.get(session.id) ?? []) append(child)
  }
  for (const root of roots) append(root)
  for (const session of sessions) append(session)
  return ordered
}

export function ProjectRail({ mode, project, sessions, selectedSession, selectedCase, cases, onMode, onSelectSession, onSelectCase, onDialog }: {
  readonly mode: Mode; readonly project: ProjectFixture; readonly sessions: readonly SessionSummary[]; readonly selectedSession?: string; readonly selectedCase: string; readonly cases: readonly StudioCase[]; readonly onMode: (mode: Mode) => void; readonly onSelectSession: (id: string) => void; readonly onSelectCase: (id: string) => void; readonly onDialog: (kind: DialogKind) => void
}) {
  const { locale, setLocale, t } = useI18n()
  const orderedSessions = sessionTreeOrder(sessions)
  return <aside className="project-rail">
    <div className="brand"><span className="brand-mark"><Icon name="knot" size={22}/></span><span>Knot</span><span className="alpha">alpha</span></div>
    <button className="project-picker" onClick={() => onDialog('projects')}><span className="project-avatar">{project.name.slice(0, 1).toUpperCase()}</span><span><strong>{project.name}</strong><small>{project.summary}</small></span><Icon name="down" size={13}/></button>
    <div className="rail-mode"><ModeSwitch mode={mode} onChange={onMode}/></div>
    <nav className="rail-scroll">
      <div className="section-heading"><span>{t('nav.sessions')}</span><button aria-label={t('nav.newSession')} onClick={() => onDialog('new-session')}><Icon name="plus" size={15}/></button></div>
      <div className="session-list">{orderedSessions.map(session => <button key={session.id} className={`session-row ${session.parentSessionId === undefined ? '' : 'subagent-session'} ${selectedSession === session.id && mode === 'run' ? 'active' : ''}`} onClick={() => onSelectSession(session.id)}><Icon name={session.parentSessionId === undefined ? 'message' : 'branch'} size={15}/><span><strong>{session.title}</strong><small>{session.parentSessionId === undefined ? session.assembly.toUpperCase() : t('nav.subagent')} · {t(`status.${session.runState}`)} · {t('nav.facts', { count: session.eventCount })}</small></span>{session.runState === 'running' && <i/>}</button>)}{sessions.length === 0 && <span className="empty-sessions">{t('nav.noSessions')}</span>}</div>
      <div className="section-heading cases-heading"><span>{t('nav.cases')}</span><button aria-label={t('nav.newCase')} onClick={() => onDialog('new-case')}><Icon name="plus" size={15}/></button></div>
      {cases.map(item => <button key={item.id} className={`nav-row ${selectedCase === item.id && mode === 'studio' ? 'active' : ''}`} onClick={() => onSelectCase(item.id)}><Icon name="case" size={15}/><span>{item.title}</span><b>{item.runCount}</b></button>)}
    </nav>
    <div className="rail-footer"><button className="nav-row" onClick={() => onDialog('settings')}><Icon name="settings" size={16}/><span>{t('nav.projectSettings')}</span></button><div className="runtime"><span className="status-dot"/>{t('nav.runtimeReady')} <button className="locale-toggle" onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}>{t('language.toggle')}</button></div></div>
  </aside>
}

export function WorkbenchHeader({ mode, project, session, currentCase, workspace, model, inspectorOpen, onModel, onSettings, onInspector }: {
  readonly mode: Mode; readonly project: ProjectFixture; readonly session?: SessionSummary; readonly currentCase: StudioCase; readonly workspace: string; readonly model: string; readonly inspectorOpen: boolean; readonly onModel: () => void; readonly onSettings: () => void; readonly onInspector: () => void
}) {
  const { t } = useI18n()
  return <header className="workbench-header"><div className="breadcrumb"><span>{project.name}</span><b>/</b><strong>{mode === 'run' ? session?.title ?? t('header.noSession') : currentCase.title}</strong></div><div className="header-actions"><button className="path-button" onClick={onSettings} title={workspace}><Icon name="folder" size={14}/><span>{workspace.split('/').filter(Boolean).at(-1) ?? workspace}</span></button><span className="branch"><Icon name="branch" size={14}/>main</span><button className="model-button" onClick={onModel}><span className="model-dot"/>{model}<Icon name="down" size={12}/></button>{!inspectorOpen && <button className="icon-button framed" onClick={onInspector} title={t('header.openInspector')}><Icon name="panel" size={16}/></button>}</div></header>
}

export function Dialog({ kind, project, projects, currentCase, providerProfiles, providerProfileId, onClose, onCreateSession, onCreateCase, onCreateProject, onSelectProject, onProviderProfile }: { readonly kind: DialogKind; readonly project: ProjectFixture; readonly projects: readonly ProjectFixture[]; readonly currentCase: StudioCase; readonly providerProfiles: readonly ProviderProfileSummary[]; readonly providerProfileId: string; readonly onClose: () => void; readonly onCreateSession: (title: string, cwd: string, providerProfileId: string, reasoningEffort: ReasoningEffort | undefined, approvalMode: ApprovalMode) => void; readonly onCreateCase: (title: string) => void; readonly onCreateProject: (name: string, root: string) => void; readonly onSelectProject: (id: string) => void; readonly onProviderProfile: (providerProfileId: string) => void }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(kind === 'new-session' ? `${currentCase.title} ${t('dialog.runSuffix')}` : kind === 'projects' ? t('dialog.untitledProject') : t('dialog.untitledCase'))
  const [cwd, setCwd] = useState(kind === 'projects' ? '/Users/lizhe/workspace' : currentCase.workspace)
  const selectedProvider = providerProfiles.find(profile => profile.id === providerProfileId)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | undefined>(selectedProvider?.defaultReasoningEffort)
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('ask')
  useEffect(() => setReasoningEffort(selectedProvider?.defaultReasoningEffort), [providerProfileId, selectedProvider?.defaultReasoningEffort])
  const providerSelect = <label>{t('dialog.providerProfile')}<select value={providerProfileId} onChange={event => onProviderProfile(event.target.value)}>{providerProfiles.map(profile => <option key={profile.id} value={profile.id} disabled={!profile.configured}>{profile.label}{profile.configured ? '' : ` · ${t('dialog.notConfigured')}`}</option>)}</select></label>
  const reasoningSelect = <label>{t('dialog.reasoningEffort')}<select value={reasoningEffort ?? ''} disabled={selectedProvider?.reasoningEfforts === undefined} onChange={event => setReasoningEffort(event.target.value === '' ? undefined : event.target.value as ReasoningEffort)}><option value="">{t('dialog.providerDefault')}</option>{selectedProvider?.reasoningEfforts?.map(effort => <option key={effort} value={effort}>{effort}</option>)}</select></label>
  const approvalSelect = <label>{t('dialog.toolApproval')}<select value={approvalMode} onChange={event => setApprovalMode(event.target.value as ApprovalMode)}><option value="ask">{t('dialog.approvalAsk')}</option><option value="auto">{t('dialog.approvalAuto')}</option></select></label>
  const heading = kind === 'new-session' ? t('dialog.newSession') : kind === 'new-case' ? t('dialog.newCase') : kind === 'projects' ? t('dialog.projects') : kind === 'settings' ? t('dialog.settings') : t('dialog.library')
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="dialog"><header><div><span className="eyebrow">{kind === 'settings' || kind === 'projects' ? t('dialog.project') : kind === 'plugin-library' ? t('dialog.studio') : t('dialog.create')}</span><h2>{heading}</h2></div><button className="icon-button" onClick={onClose}><Icon name="close" size={16}/></button></header>{kind === 'new-session' && <><label>{t('dialog.sessionTitle')}<input value={title} onChange={event => setTitle(event.target.value)}/></label><label>{t('dialog.workingDirectory')}<input value={cwd} onChange={event => setCwd(event.target.value)}/></label>{providerSelect}{reasoningSelect}{approvalSelect}<div className="dialog-summary"><span>{t('dialog.assembly')}</span><strong>CASE2 coding agent</strong><span>{t('dialog.model')}</span><strong>{selectedProvider?.model ?? t('dialog.noProvider')}</strong><span>{t('dialog.reasoning')}</span><strong>{reasoningEffort ?? t('dialog.providerDefault')}</strong><span>{t('dialog.approval')}</span><strong>{approvalMode}</strong></div><footer><button onClick={onClose}>{t('dialog.cancel')}</button><button className="primary" disabled={title.trim() === '' || cwd.trim() === '' || selectedProvider?.configured !== true} onClick={() => onCreateSession(title.trim(), cwd.trim(), providerProfileId, reasoningEffort, approvalMode)}>{t('dialog.createSession')}</button></footer></>}{kind === 'new-case' && <><label>{t('dialog.caseName')}<input value={title} onChange={event => setTitle(event.target.value)}/></label><p className="dialog-copy">{t('dialog.caseDescription')}</p><footer><button onClick={onClose}>{t('dialog.cancel')}</button><button className="primary" disabled={title.trim() === ''} onClick={() => onCreateCase(title.trim())}>{t('dialog.createCase')}</button></footer></>}{kind === 'projects' && <><div className="project-list">{projects.map(item => <button key={item.id} className={item.id === project.id ? 'active' : ''} onClick={() => onSelectProject(item.id)}><span className="project-avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.root}</small></span>{item.id === project.id && <Icon name="check" size={14}/>}</button>)}</div><div className="dialog-divider"><span>{t('dialog.newFixtureProject')}</span></div><label>{t('dialog.projectName')}<input value={title} onChange={event => setTitle(event.target.value)}/></label><label>{t('dialog.workspaceRoot')}<input value={cwd} onChange={event => setCwd(event.target.value)}/></label><footer><button onClick={onClose}>{t('dialog.cancel')}</button><button className="primary" disabled={title.trim() === '' || cwd.trim() === ''} onClick={() => onCreateProject(title.trim(), cwd.trim())}>{t('dialog.createProject')}</button></footer></>}{kind === 'settings' && <><div className="settings-list"><div><span>{t('dialog.projectRoot')}</span><code>{project.root}</code></div><div><span>{t('dialog.runtime')}</span><strong>{t('dialog.runtimeValue')}</strong></div><div><span>{t('dialog.storage')}</span><strong>{t('dialog.storageValue')}</strong></div><div><span>{t('dialog.defaultCase')}</span><strong>{currentCase.title}</strong></div></div>{providerSelect}<footer><button className="primary" onClick={onClose}>{t('dialog.done')}</button></footer></>}{kind === 'plugin-library' && <><div className="library-grid">{plugins.slice(2, 8).map(plugin => <button key={plugin.id} onClick={onClose}><span className={`category ${plugin.category}`}>{plugin.category}</span><strong>{plugin.name}</strong><small>{plugin.responsibility}</small><i>{t('dialog.alreadyAssembled')}</i></button>)}</div><p className="dialog-copy">{t('dialog.libraryDescription')}</p></>}</section></div>
}
