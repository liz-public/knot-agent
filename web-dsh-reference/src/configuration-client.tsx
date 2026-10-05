/** Small Knot-owned configuration surfaces in the published DSH Client slots.
 * No Journal writes here: the carrier calls existing Host APIs, which own pending configuration.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Input, Menu, Modal, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProviderProfileSummary } from '../../src/workbench/provider-profile.js'
import type { ProviderProfileDraft } from '../../src/workbench/provider-profile-store.js'
import type { SessionSummaryDto } from '../../src/workbench/session.js'
import { extendNativeSlot } from './native-slot.ts'

type Call = <T>(endpoint: string, input?: unknown) => Promise<T>
interface Catalog { providers: ProviderProfileSummary[]; assemblies: { id: string; title: string }[] }
type InferenceCatalog = Pick<Catalog, 'providers'>
const blank: ProviderProfileDraft = { label: '', adapter: 'openai-compatible', model: '' }
const editable = (session: SessionSummaryDto) => session.writable && session.runState === 'idle'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="knot-config-field"><span>{label}</span>{children}</label>
}
function ErrorText({ value }: { value: string }) {
  return value ? <p role="alert" className="knot-config-error">{value}</p> : null
}
function InferenceFields({ catalog, profileId, effort, onProfile, onEffort }: {
  catalog: InferenceCatalog; profileId: string; effort: string; onProfile: (id: string) => void; onEffort: (effort: string) => void;
}) {
  const profile = catalog.providers.find(item => item.id === profileId)
  return <>
    <Field label="Provider / 模型"><select value={profileId} onChange={e => onProfile(e.target.value)}>
      <option value="" disabled>选择已配置的 Provider</option>
      {catalog.providers.map(item => <option key={item.id} value={item.id} disabled={!item.configured}>
        {item.label} · {item.model}{item.configured ? '' : '（未配置）'}
      </option>)}
    </select></Field>
    <Field label="推理强度"><select value={effort} onChange={e => onEffort(e.target.value)} disabled={!profile?.reasoningEfforts?.length}>
      <option value="">Provider 默认</option>
      {profile?.reasoningEfforts?.map(value => <option key={value} value={value}>{value}</option>)}
    </select></Field>
  </>
}
function ApprovalField({ value, change }: { value: string; change: (value: 'ask' | 'auto') => void }) {
  return <Field label="工具审批"><select value={value} onChange={e => change(e.target.value as 'ask' | 'auto')}>
    <option value="ask">手动审批</option><option value="auto">自动批准（不是自动审查；无沙箱）</option>
  </select></Field>
}

function SessionModel({ call, sessionId }: { call: Call; sessionId: string }) {
  const [session, setSession] = useState<SessionSummaryDto>()
  const [catalog, setCatalog] = useState<InferenceCatalog>()
  const [open, setOpen] = useState<'model' | 'approval'>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const [next, options] = await Promise.all([call<SessionSummaryDto>('knot/session', { sessionId }), call<InferenceCatalog>('knot/providers')])
    setSession(next); setCatalog(options)
  }
  useEffect(() => { let active = true
    if (!sessionId) return
    void call<SessionSummaryDto>('knot/session', { sessionId }).then(value => { if (active) setSession(value) })
      .catch(value => { if (active) setError(String(value)) })
    return () => { active = false }
  }, [sessionId, call])
  const show = async (kind: 'model' | 'approval') => { setError(''); setOpen(kind); setBusy(true)
    try { await load() } catch (value) { setError(String(value)) } finally { setBusy(false) }
  }
  const save = async (selection: string) => {
    if (!session) return
    const providerProfileId = selection.startsWith('provider:') ? selection.slice(9) : session.providerProfileId
    const reasoningEffort = selection.startsWith('provider:') ? ''
      : selection.startsWith('effort:') ? selection.slice(7) : session.reasoningEffort ?? ''
    const approvalMode = selection.startsWith('approval:') ? selection.slice(9) : session.approvalMode ?? 'ask'
    if (approvalMode === 'auto' && session.approvalMode !== 'auto'
      && !window.confirm('自动批准将允许工具直接操作工作目录或设备，没有沙箱。确认启用？')) return
    setBusy(true); setError('')
    try {
      setSession(await call<SessionSummaryDto>('knot/session/configure', {
        sessionId, providerProfileId, reasoningEffort, approvalMode,
      })); setOpen(undefined)
    } catch (value) { setError(String(value)) } finally { setBusy(false) }
  }
  const disabled = busy || !session || !editable(session)
  if (!sessionId) return null
  const profile = catalog?.providers.find(item => item.id === session?.providerProfileId)
  const modelItems: MenuEntry[] = [
    { type: 'label', id: 'models', text: '模型 · 下一轮生效' },
    ...(catalog?.providers ?? []).map(item => ({ id: 'provider:' + item.id,
      label: `${item.label} · ${item.model}`, disabled: disabled || !item.configured })),
    { type: 'separator', id: 'separator' }, { type: 'label', id: 'efforts', text: '推理强度' },
    { id: 'effort:', label: 'Provider 默认', disabled },
    ...(profile?.reasoningEfforts ?? []).map(value => ({ id: 'effort:' + value, label: value, disabled })),
  ]
  return <span className="knot-config-controls">
    <Menu open={open === 'model'} onClose={() => setOpen(undefined)} side="top" portal compact
      items={modelItems} selectedIds={['provider:' + session?.providerProfileId, 'effort:' + (session?.reasoningEffort ?? '')]}
      onSelect={id => void save(id)} anchor={<button className="knot-config-chip" onClick={() => void show('model')} title="Session 模型 · 下一轮生效">
      {session?.model ?? '模型配置'}{session?.reasoningEffort ? ` · ${session.reasoningEffort}` : ''} ▾
    </button>} />
    <Menu open={open === 'approval'} onClose={() => setOpen(undefined)} side="top" portal compact
      selectedId={'approval:' + (session?.approvalMode ?? 'ask')}
      items={[{ id: 'approval:ask', label: '手动审批', disabled },
        { id: 'approval:auto', label: '自动批准（无沙箱）', disabled }]}
      onSelect={id => void save(id)} anchor={<button className="knot-config-chip" onClick={() => void show('approval')} title="工具审批策略 · 下一轮生效">
      {session?.approvalMode === 'auto' ? '自动批准' : '手动审批'} ▾
    </button>} />
    <ErrorText value={error} />
  </span>
}

function Providers({ call }: { call: Call }) {
  const [catalog, setCatalog] = useState<InferenceCatalog>()
  const [draft, setDraft] = useState<ProviderProfileDraft>()
  const [id, setId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = async () => setCatalog(await call<InferenceCatalog>('knot/providers'))
  useEffect(() => { void load().catch(value => setError(String(value))) }, [call])
  const action = async (run: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setMessage('')
    try { await run(); await load(); setMessage(success) } catch (value) { setError(String(value)) } finally { setBusy(false) }
  }
  const edit = (profile?: ProviderProfileSummary) => {
    setId(profile?.id); setDraft(profile ? { label: profile.label, adapter: profile.adapter, model: profile.model,
      baseUrl: profile.baseUrl, contextWindow: profile.contextWindow, defaultReasoningEffort: profile.defaultReasoningEffort } : blank)
    setError(''); setMessage('')
  }
  const update = (value: Partial<ProviderProfileDraft>) => setDraft(previous => previous ? { ...previous, ...value } : previous)
  return <div className="knot-config">
    <h3>模型 Provider</h3><p className="knot-config-muted">使用 Knot 的 DeepSeek / OpenAI-compatible 配置。API Key 只交给 Host，不读取或存入浏览器。</p>
    <div><Button disabled={busy} onClick={() => edit()}>新增 Provider</Button></div>
    {catalog?.providers.map(profile => <section key={profile.id} className="knot-config-card">
      <strong>{profile.label}{profile.isDefault ? ' · 默认' : ''}</strong><span>{profile.adapter} · {profile.model}</span>
      <span className="knot-config-muted">{profile.configured ? '已配置' : '未配置'}{profile.editable === false ? ' · 环境变量配置（只读）' : ''}</span>
      <div className="knot-config-actions">
        <Button size="sm" variant="outline" disabled={busy || profile.editable === false} onClick={() => edit(profile)}>编辑</Button>
        <Button size="sm" variant="outline" disabled={busy || !profile.configured} onClick={() => {
          if (window.confirm('测试会发起一次真实的模型 API 请求，可能产生费用。继续？')) void action(() => call('knot/providers/test', { id: profile.id }), '连接测试成功')
        }}>测试</Button>
        <Button size="sm" variant="outline" disabled={busy || !profile.configured || profile.isDefault} onClick={() => void action(() => call('knot/providers/default', { id: profile.id }), '已设置默认 Provider')}>设为默认</Button>
        <Button size="sm" variant="outline" disabled={busy || profile.editable === false} onClick={() => {
          if (window.confirm(`删除 ${profile.label}？使用该配置的历史 Session 可能无法继续运行。`)) void action(() => call('knot/providers/delete', { id: profile.id }), '已删除')
        }}>删除</Button>
      </div>
    </section>)}
    <p role="status">{message}</p><ErrorText value={error} />
    <Modal open={!!draft} onClose={() => setDraft(undefined)} title={id ? '编辑 Provider' : '新增 Provider'} closeLabel="关闭"
      footer={<Button disabled={busy || !draft?.label.trim() || !draft.model.trim()} onClick={() => void action(async () => {
        const value = { ...draft }
        if (!value.apiKey?.trim()) delete value.apiKey
        await call('knot/providers/save', { ...value, ...(id ? { id } : {}) }); setDraft(undefined)
      }, 'Provider 已保存')}>保存</Button>}>
      {draft && <div className="knot-config">
        <Field label="名称"><Input value={draft.label} onChange={e => update({ label: e.target.value })} /></Field>
        <Field label="API 格式"><select value={draft.adapter} onChange={e => update({ adapter: e.target.value as ProviderProfileDraft['adapter'], defaultReasoningEffort: undefined })}>
          <option value="openai-compatible">OpenAI-compatible</option><option value="deepseek">DeepSeek</option>
        </select></Field>
        <Field label="模型 ID"><Input value={draft.model} onChange={e => update({ model: e.target.value })} /></Field>
        <Field label="Base URL"><Input value={draft.baseUrl ?? ''} onChange={e => update({ baseUrl: e.target.value })} placeholder={draft.adapter === 'deepseek' ? '默认 DeepSeek 官方地址' : 'https://…/v1'} /></Field>
        <Field label={id ? 'API Key（留空保留原值）' : 'API Key'}><Input type="password" autoComplete="new-password" value={draft.apiKey ?? ''} onChange={e => update({ apiKey: e.target.value })} /></Field>
        <Field label="上下文窗口（可选）"><Input type="number" min="1" value={draft.contextWindow ?? ''} onChange={e => update({ contextWindow: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        {draft.adapter === 'deepseek' && <Field label="默认推理强度"><select value={draft.defaultReasoningEffort ?? ''} onChange={e => update({ defaultReasoningEffort: (e.target.value || undefined) as ProviderProfileDraft['defaultReasoningEffort'] })}>
          <option value="">API 默认</option>{['none', 'low', 'high', 'max'].map(value => <option key={value}>{value}</option>)}
        </select></Field>}
        <ErrorText value={error} />
      </div>}
    </Modal>
  </div>
}

function NewSession({ call, openSession, close }: { call: Call; openSession: (id: string) => Promise<void>; close: () => void }) {
  const [catalog, setCatalog] = useState<Catalog>()
  const [title, setTitle] = useState('')
  const [cwd, setCwd] = useState('')
  const [assemblyId, setAssembly] = useState('')
  const [profileId, setProfile] = useState('')
  const [effort, setEffort] = useState('')
  const [approval, setApproval] = useState<'ask' | 'auto'>('ask')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void call<Catalog>('knot/catalog').then(options => {
    setCatalog(options); setAssembly(options.assemblies[0]?.id ?? '')
    setProfile(options.providers.find(item => item.isDefault && item.configured)?.id ?? options.providers.find(item => item.configured)?.id ?? '')
  }).catch(value => setError(String(value))) }, [call])
  const create = async () => {
    if (approval === 'auto' && !window.confirm('此新 Session 的工具将自动批准执行，没有沙箱。继续？')) return
    setBusy(true); setError('')
    try {
      const session = await call<SessionSummaryDto>('knot/session/create', {
        assemblyId, providerProfileId: profileId, approvalMode: approval,
        ...(title.trim() ? { title: title.trim() } : {}), ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        ...(effort ? { reasoningEffort: effort } : {}),
      })
      await openSession(session.id); close()
    } catch (value) { setError(String(value)) } finally { setBusy(false) }
  }
  return <div className="knot-config">
    <h3>新建 Knot Session</h3><p className="knot-config-muted">先选择 Assembly，再创建会话；不执行模型或工具。侧栏原生“新建”继续使用 Host 默认 Assembly。</p>
    <Field label="Assembly"><select value={assemblyId} onChange={e => setAssembly(e.target.value)}>
      {catalog?.assemblies.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select></Field>
    <Field label="会话名称（可选）"><Input value={title} onChange={e => setTitle(e.target.value)} /></Field>
    <Field label="工作目录（留空使用 Host 默认）"><Input value={cwd} onChange={e => setCwd(e.target.value)} /></Field>
    {catalog && <InferenceFields catalog={catalog} profileId={profileId} effort={effort} onEffort={setEffort} onProfile={id => { setProfile(id); setEffort('') }} />}
    <ApprovalField value={approval} change={setApproval} /><ErrorText value={error} />
    <div><Button disabled={busy || !assemblyId || !profileId} onClick={() => void create()}>创建并打开 Session</Button></div>
  </div>
}

function RuntimeDock({ call, sessionId }: { call: Call; sessionId: string }) {
  const [error, setError] = useState('')
  useEffect(() => {
    if (!sessionId) return
    const abort = new AbortController()
    setError('')
    void (async () => {
      const rpc = (window as any).__DSH_TRANSPORT__.rpc
      for await (const event of rpc.open('$knot', 'knot/live', { args: [{ sessionId }] }, abort.signal)) {
        if (event.kind === 'state.changed' && event.runState === 'running') setError('')
        if (event.kind === 'run.error') setError(event.message)
      }
    })().catch(value => { if (!abort.signal.aborted) setError(String(value)) })
    return () => abort.abort()
  }, [call, sessionId])
  return error ? <div className="knot-runtime"><ErrorText value={error} /></div> : null
}

export const inject = ['slots', 'uiWorkspace', 'sessions']
// The transport is the sole browser-facing Knot wire boundary.
export function apply(ctx: any): void {
  const call: Call = async (endpoint, input = {}) => {
    const transport = (window as any).__DSH_TRANSPORT__
    const result = await transport.rpc.call('$knot', endpoint, { args: [input] }, new AbortController().signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  extendNativeSlot(ctx, 'conversation.composer.bar', () => true, native => {
    const Original = native.component
    function Composer(props: any) {
      const snapshotState = props.useProjection('knotRunState')
      const [liveState, setLiveState] = useState<string>()
      const paused = (liveState ?? snapshotState) === 'paused'
      const [error, setError] = useState('')
      const [resuming, setResuming] = useState(false)
      useEffect(() => { setError(''); setResuming(false) }, [props.sessionId, paused])
      useEffect(() => {
        const abort = new AbortController()
        setLiveState(undefined)
        if (!props.sessionId) return
        // Pause can change without a new Journal fact. Native sequenced
        // projections reject equal-seq updates, so use the transient live port.
        void (async () => {
          const rpc = (window as any).__DSH_TRANSPORT__.rpc
          for await (const event of rpc.open('$knot', 'knot/live', { args: [{ sessionId: props.sessionId }] }, abort.signal)) {
            if (event.kind === 'state.changed') setLiveState(event.runState)
          }
        })().catch(value => { if (!abort.signal.aborted) setError(String(value)) })
        return () => abort.abort()
      }, [props.sessionId])
      const useStopShortcut = useCallback((selector: any) => props.useStopShortcut((keys: any) =>
        selector(paused ? [] : keys)), [props.useStopShortcut, paused])
      const zh = document.documentElement.lang.startsWith('zh')
      const notice = useMemo(() => error ? { level: 'error', text: error } : undefined, [error])
      const useNotices = useCallback((selector: any) => props.useNotices((current: any) =>
        selector(notice ?? current)), [props.useNotices, notice])
      const primaryAction = paused && !props.blocked ? {
        label: zh ? '恢复运行' : 'Resume', disabled: resuming,
        icon: <path d="M5 3.5v9l7-4.5z" fill="currentColor" />,
        onClick: () => {
          if (resuming) return
          setResuming(true); setError('')
          void call('knot/session/resume', { sessionId: props.sessionId })
            .catch(value => setError(String(value))).finally(() => setResuming(false))
        },
      } : undefined
      return <Original {...props} primaryAction={primaryAction} useStopShortcut={useStopShortcut} useNotices={useNotices}
          stop={paused ? undefined : props.stop}
          blocked={props.blocked ?? (paused ? { reason: 'Pause requested' } : undefined)}
          t={(key: string, params: any) => key === 'placeholder.unavailable' && paused && !props.blocked
            ? (zh ? '暂停已请求，点击恢复后继续' : 'Pause requested; resume to continue') : key === 'input.stop'
              ? paused ? (zh ? '恢复运行' : 'Resume') : (zh ? '优雅暂停' : 'Pause gracefully') : props.t(key, params)} />
    }
    // Keep the original entry's child-slot ownership and injected hooks. A new
    // shadow entry cannot redeclare these children. This wraps the public
    // mutable component seat at assembly time, without copying the InputBar.
    ctx.effect(() => {
      native.component = Composer
      return () => { native.component = Original }
    })
  })
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model', inject: (sessionId: string) => ({ call, sessionId }),
  }, SessionModel))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'knot-runtime', order: 50,
    inject: (sessionId: string) => ({ call, sessionId }),
  }, RuntimeDock))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'models', order: 10, label: () => '模型 Provider', inject: () => ({ call }),
  }, Providers))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'knot-new-session', order: 11, label: () => '新建 Session',
    inject: () => ({ call, openSession: async (id: string) => {
      // Creation is acknowledged before forwarded catalog notifications settle.
      await ctx.sessions.refresh()
      ctx.uiWorkspace.openSession(id)
    } }),
  }, NewSession))
}
