import { useEffect, useState } from 'react'
import {
  createProviderProfile,
  deleteProviderProfile,
  setDefaultProviderProfile,
  testProviderProfile,
  updateProviderProfile,
  type ProviderProfileDraft,
  type ProviderProfileSummary,
  type SessionSummary,
} from '../api/workbench-api'
import { Icon } from '../components/Icon'
import { useI18n } from '../i18n'

interface Props {
  readonly mode: 'session-model' | 'providers'
  readonly profiles: readonly ProviderProfileSummary[]
  readonly session?: SessionSummary
  readonly onClose: () => void
  readonly onManage: () => void
  readonly onChanged: (profiles: readonly ProviderProfileSummary[]) => void
  readonly reload: () => Promise<readonly ProviderProfileSummary[]>
}

function draftFrom(profile?: ProviderProfileSummary): ProviderProfileDraft {
  return profile === undefined
    ? { label: '', adapter: 'openai-compatible', model: '', baseUrl: '' }
    : {
        label: profile.label,
        adapter: profile.adapter,
        model: profile.model,
        ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
        ...(profile.contextWindow === undefined ? {} : { contextWindow: profile.contextWindow }),
        ...(profile.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: profile.defaultReasoningEffort }),
      }
}

export function ProviderDialog(props: Props) {
  const { t } = useI18n()
  const active = props.profiles.find(profile => profile.id === props.session?.providerProfileId)
  const [selectedId, setSelectedId] = useState<string | undefined>(props.profiles[0]?.id)
  const selected = props.profiles.find(profile => profile.id === selectedId)
  const [draft, setDraft] = useState<ProviderProfileDraft>(() => draftFrom(selected))
  const [busy, setBusy] = useState<string>()
  const [message, setMessage] = useState<string>()

  useEffect(() => setDraft(draftFrom(selected)), [selectedId, selected])

  async function run(name: string, action: () => Promise<void>) {
    try {
      setBusy(name); setMessage(undefined)
      await action()
      props.onChanged(await props.reload())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }

  if (props.mode === 'session-model') {
    return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
      <section className="dialog model-dialog">
        <header><div><span className="eyebrow">{t('provider.session')}</span><h2>{t('provider.sessionModel')}</h2></div><button className="icon-button" onClick={props.onClose}><Icon name="close" size={16}/></button></header>
        {props.session === undefined ? <p className="dialog-copy">{t('provider.noSession')}</p> : <div className="session-model-card">
          <span>{t('provider.profile')}</span><strong>{active?.label ?? props.session.providerProfileId ?? t('dialog.noProvider')}</strong>
          <span>{t('dialog.model')}</span><strong>{props.session.model ?? active?.model ?? t('run.unknown')}</strong>
          <span>{t('dialog.reasoning')}</span><strong>{props.session.reasoningEffort ?? active?.defaultReasoningEffort ?? t('dialog.providerDefault')}</strong>
          <small>{t('provider.fixedForSession')}</small>
        </div>}
        <footer><button onClick={props.onManage}>{t('provider.manage')}</button><button className="primary" onClick={props.onClose}>{t('dialog.done')}</button></footer>
      </section>
    </div>
  }

  const valid = draft.label.trim() !== '' && draft.model.trim() !== ''
    && (draft.adapter === 'deepseek'
      ? selected?.hasApiKey === true || (draft.apiKey?.trim().length ?? 0) > 0
      : (draft.baseUrl?.trim().length ?? 0) > 0)
  const editable = selected === undefined || selected.editable === true
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
    <section className="dialog provider-dialog">
      <header><div><span className="eyebrow">{t('provider.host')}</span><h2>{t('provider.manage')}</h2></div><button className="icon-button" onClick={props.onClose}><Icon name="close" size={16}/></button></header>
      <div className="provider-layout">
        <nav className="provider-list">
          {props.profiles.map(profile => <button key={profile.id} className={profile.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(profile.id)}>
            <span><strong>{profile.label}</strong><small>{profile.adapter} · {profile.model}</small></span>
            {profile.isDefault && <i>{t('provider.default')}</i>}
          </button>)}
          <button className={selectedId === undefined ? 'active add' : 'add'} onClick={() => setSelectedId(undefined)}><Icon name="plus" size={14}/>{t('provider.add')}</button>
        </nav>
        <div className="provider-form">
          {selected !== undefined && !editable && <p className="provider-notice">{t('provider.environmentManaged')}</p>}
          <label>{t('dialog.providerAdapter')}<select disabled={!editable} value={draft.adapter} onChange={event => setDraft({ ...draft, adapter: event.target.value as ProviderProfileDraft['adapter'] })}><option value="openai-compatible">OpenAI-compatible</option><option value="deepseek">DeepSeek</option></select></label>
          <label>{t('dialog.providerLabel')}<input disabled={!editable} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })}/></label>
          <label>{t('dialog.model')}<input disabled={!editable} value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })}/></label>
          <label>{t('dialog.baseUrl')}<input disabled={!editable} value={draft.baseUrl ?? ''} placeholder={draft.adapter === 'deepseek' ? 'https://api.deepseek.com' : 'https://example.com/v1'} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })}/></label>
          <label>{t('dialog.apiKey')}<input disabled={!editable} type="password" autoComplete="off" value={draft.apiKey ?? ''} placeholder={selected?.hasApiKey ? t('provider.keepSecret') : ''} onChange={event => setDraft({ ...draft, apiKey: event.target.value })}/></label>
          <label>{t('dialog.contextWindow')}<input disabled={!editable} inputMode="numeric" value={draft.contextWindow ?? ''} onChange={event => setDraft({ ...draft, contextWindow: event.target.value === '' ? undefined : Number(event.target.value) })}/></label>
          {message !== undefined && <p className="provider-message">{message}</p>}
          <div className="provider-actions">
            {selected !== undefined && <button disabled={busy !== undefined || !selected.configured} onClick={() => void run('test', async () => { await testProviderProfile(selected.id); setMessage(t('provider.testPassed')) })}>{busy === 'test' ? t('provider.testing') : t('provider.test')}</button>}
            {selected !== undefined && !selected.isDefault && <button disabled={busy !== undefined || !selected.configured} onClick={() => void run('default', () => setDefaultProviderProfile(selected.id).then(() => undefined))}>{t('provider.makeDefault')}</button>}
            {editable && <button className="primary" disabled={busy !== undefined || !valid} onClick={() => void run('save', async () => {
              const saved = selected === undefined ? await createProviderProfile(draft) : await updateProviderProfile(selected.id, draft)
              setSelectedId(saved.id)
            })}>{busy === 'save' ? t('provider.saving') : t('provider.save')}</button>}
            {selected?.editable === true && <button className="danger" disabled={busy !== undefined} onClick={() => {
              if (!window.confirm(t('provider.deleteConfirm', { label: selected.label }))) return
              void run('delete', async () => { await deleteProviderProfile(selected.id); setSelectedId(undefined) })
            }}>{t('provider.delete')}</button>}
          </div>
          <small>{t('dialog.providerSecretHint')}</small>
        </div>
      </div>
      <footer><button className="primary" onClick={props.onClose}>{t('dialog.done')}</button></footer>
    </section>
  </div>
}
