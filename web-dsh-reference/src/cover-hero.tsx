import { useRef, useState, type ReactNode } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { coverPreset } from './cover-preset.ts'

const imageTypes = /^(image\/(png|jpeg|webp|avif|gif))$/

/** Browser-local decoration only: no Host upload, Session configuration or Journal event. */
export function CoverHero({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  const key = `knot:session-cover:${sessionId}`
  const [image, setImage] = useState(() => {
    try { return localStorage.getItem(key) ?? '' } catch { return '' }
  })
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const save = (value: string) => {
    try {
      if (value) localStorage.setItem(key, value)
      else localStorage.removeItem(key)
      setImage(value); setError('')
    } catch { setError('浏览器存储空间不足，未保存封面。请使用预制图或较小的图片。') }
  }
  return <header className="knot-cover-hero" data-image={image ? 'true' : undefined}>
    {image && <img className="knot-cover-image" src={image} alt="" onError={() => setError('无法读取这张图片，请更换或恢复默认封面。')} />}
    {children}
    <div className="knot-cover-appearance">
      <Menu open={open} onClose={() => setOpen(false)} side="bottom" portal compact
        items={[{ id: 'preset', label: '使用预制封面' }, { id: 'upload', label: '选择本地图片…' },
          { id: 'reset', label: '恢复默认', disabled: !image }]}
        onSelect={id => { setOpen(false); setError(''); if (id === 'upload') input.current?.click(); else save(id === 'preset' ? coverPreset : '') }}
        anchor={<button className="knot-cover-change" onClick={() => setOpen(!open)}>更换封面</button>} />
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" hidden aria-label="选择会话封面图片"
        onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (!file) return
          if (!imageTypes.test(file.type) || file.size > 2 * 1024 * 1024) { setError('请选择不超过 2 MB 的 PNG、JPEG、WebP、AVIF 或 GIF 图片。'); return }
          const reader = new FileReader()
          reader.onload = () => save(String(reader.result))
          reader.onerror = () => setError('读取图片失败，请重新选择。')
          reader.readAsDataURL(file)
        }} />
    </div>
    {error && <p className="knot-cover-image-error" role="alert">{error}</p>}
  </header>
}
