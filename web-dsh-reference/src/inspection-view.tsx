/** Small read/display helpers, not a second inspection runtime or data store. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, JsonTree } from '@deepseek-ai/dsh-client-ui-primitives'

export interface ViewProps {
  sessionId: string
  useProjection: (key: string) => any
  openView: (view: string, focus: string) => void
  viewRequest: { view: string; focus: string } | null
  completeViewRequest: () => void
}
export const percent = (value?: number) => value === undefined ? '—' : (value * 100).toFixed(2) + '%'
export function useRead<T>(endpoint: string | undefined, input: Record<string, unknown>, revision?: unknown) {
  const key = JSON.stringify(input)
  const [value, setValue] = useState<T>()
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setValue(undefined); setError('')
    if (endpoint) void (window as any).__DSH_TRANSPORT__.rpc.call('$knot', endpoint,
      { args: [JSON.parse(key)] }, abort.signal).then((result: any) => {
      if (abort.signal.aborted) return
      if (!result.ok) setError(result.error.message)
      else setValue(result.value)
    }, (error: unknown) => { if (!abort.signal.aborted) setError(String(error)) })
    return () => abort.abort()
  }, [endpoint, key, revision, reload])
  return { value, error, refresh: () => setReload(n => n + 1) }
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function Panel({ title, note, refresh, error, children, actions }: {
  title: string; note: string; refresh: () => void; error: string; children: ReactNode; actions?: ReactNode
}) {
  return <section className="knot-inspection"><header className="knot-inspection-heading"><div>
    <h2>{title}</h2><p>{note}</p></div><div className="knot-inspection-actions">{actions}<Button onClick={refresh}>刷新</Button></div></header>
    {error && <p role="alert" className="knot-inspection-error">{error}</p>}{children}</section>
}
export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="knot-metric"><span>{label}</span><strong>{children}</strong></div>
}
const labels = { copyValue: '复制值', copyJson: '复制 JSON', copyPath: '复制路径', copyPrettyJson: '复制格式化 JSON',
  copyCompactJson: '复制紧凑 JSON', copied: '已复制', copyFailed: '复制失败', collapseNode: '折叠', expandNode: '展开', copyButtonTitle: (action: string) => action }
export function JsonDetails({ title, value }: { title: string; value: object }) {
  const [open, setOpen] = useState(false)
  return <details className="knot-data" onToggle={e => setOpen(e.currentTarget.open)}><summary>{title}</summary>
    {open && <JsonTree data={value} label={title} labels={labels} />}</details>
}
