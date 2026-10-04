import { useState } from 'react'
import type { ContextTimelinePoint } from '../../src/workbench/context-projection.js'
import { percent } from './inspection-view.tsx'

// Stable stacking/color order across calls, not independently sorted snapshots.
export const contextCategories = [
  { key: 'system', label: 'System / 固定上下文 / 指令', color: '#818cf8' },
  { key: 'tool_schemas', label: '工具 Schema', color: '#38bdf8' },
  { key: 'user', label: '用户输入', color: '#34d399' },
  { key: 'dynamic', label: '动态上下文', color: '#a3e635' },
  { key: 'assistant', label: '模型文本', color: '#fbbf24' },
  { key: 'reasoning', label: '历史推理', color: '#fb923c' },
  { key: 'tool_arguments', label: '工具参数', color: '#f472b6' },
  { key: 'tool_results', label: '工具结果', color: '#c084fc' },
  { key: 'history_bundle', label: '压缩任务的历史包', color: '#2dd4bf' },
  { key: 'envelope', label: 'JSON 结构与转义', color: '#94a3b8' },
] as const

/** Step areas: each column is exactly one call; no interpolated or sampled inputs. */
export function contextBands(points: readonly ContextTimelinePoint[]) {
  const lower = points.map(() => 0)
  return contextCategories.map(category => {
    const segments = points.map((point, index) => {
      const bottom = lower[index]!
      const share = point.breakdown?.find(row => row.key === category.key)?.share ?? 0
      lower[index] = bottom + share
      return { index, bottom, top: bottom + share, known: point.breakdown !== undefined }
    })
    return { ...category, segments }
  })
}

const left = 52, top = 16, width = 920, height = 220
const y = (share: number) => top + height * (1 - share)
export function ContextChart({ points, selectedId, onSelect }: {
  points: readonly ContextTimelinePoint[]; selectedId?: string; onSelect: (id: string) => void
}) {
  const [hovered, setHovered] = useState<string>()
  const selectedIndex = points.findIndex(point => point.requestId === selectedId)
  const focusIndex = points.findIndex(point => point.requestId === hovered)
  const index = focusIndex >= 0 ? focusIndex : selectedIndex >= 0 ? selectedIndex : points.length - 1
  const point = points[index]
  if (!point) return <p className="knot-inspection-note">还没有可展示的模型调用。</p>
  const column = width / points.length
  const x = (index: number) => left + column * index
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 4), Math.floor((points.length - 1) / 2),
    Math.floor(3 * (points.length - 1) / 4), points.length - 1])]
  const bands = contextBands(points)
  return <section className="knot-context-chart" aria-label="上下文构成随模型调用的变化">
    <h3>上下文构成 · 调用历程</h3>
    <p className="knot-inspection-note">每列为一次调用，按真实重建输入的字符占比堆积至 100%；不是 Token 占比，也不代表绝对长度。悬停查看，点击选择详细输入。含压缩调用。</p>
    <div className="knot-context-chart-scroll"><svg viewBox="0 0 1000 282" onMouseLeave={() => setHovered(undefined)}>
      <title>100% 堆积上下文图，横轴为模型调用顺序，纵轴为字符占比</title>
      <rect x={left} y={top} width={width} height={height} fill="var(--dsw-alias-border-l3)" />
      {bands.map(band => <path key={band.key} fill={band.color} pointerEvents="none" d={band.segments
        .filter(segment => segment.known && segment.top > segment.bottom).map(segment =>
          `M${x(segment.index)},${y(segment.top)}H${x(segment.index + 1)}V${y(segment.bottom)}H${x(segment.index)}Z`).join(' ')} />)}
      {[0, .25, .5, .75, 1].map(share => <g key={share} className="knot-context-chart-axis">
        <line x1={left} x2={left + width} y1={y(share)} y2={y(share)} />
        <text x={left - 10} y={y(share) + 4} textAnchor="end">{share * 100}%</text>
      </g>)}
      {ticks.map(index => <text key={index} x={x(index + .5)} y={top + height + 22} textAnchor="middle" className="knot-context-chart-tick">{index + 1}</text>)}
      <text x={left + width / 2} y={278} textAnchor="middle" className="knot-context-chart-tick">模型调用</text>
      {points.map((point, n) => <rect key={point.requestId} x={x(n)} y={top} width={column} height={height}
        fill="transparent" role="button" tabIndex={n === (selectedIndex >= 0 ? selectedIndex : points.length - 1) ? 0 : -1}
        aria-label={`第 ${n + 1} 次调用 · ${point.purpose} · ${point.totalChars?.toLocaleString() ?? '未知'} 字符`}
        aria-pressed={point.requestId === selectedId} onMouseEnter={() => setHovered(point.requestId)}
        onFocus={() => setHovered(point.requestId)} onBlur={() => setHovered(undefined)} onClick={() => onSelect(point.requestId)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(point.requestId) }
          const target = event.key === 'ArrowLeft' ? n - 1 : event.key === 'ArrowRight' ? n + 1 : -1
          if (points[target]) { event.preventDefault(); onSelect(points[target]!.requestId);
            (event.currentTarget.parentElement?.querySelectorAll('[role="button"]')[target] as SVGElement | undefined)?.focus() }
        }}><title>{point.error ?? `${point.requestId} · ${point.totalChars?.toLocaleString()} 字符`}</title></rect>)}
      <line x1={x(index + .5)} x2={x(index + .5)} y1={top} y2={top + height}
        className="knot-context-chart-cursor" pointerEvents="none" />
    </svg></div>
    <p className="knot-context-chart-caption">第 {index + 1}/{points.length} 次 · #{point.position} · {point.purpose} · {point.totalChars?.toLocaleString() ?? '未知'} 字符 <code>{point.requestId}</code></p>
    {point.error ? <p role="alert" className="knot-inspection-error">本次无法重建：{point.error}。图中保留空缺，不按零占比处理。</p> :
      <div className="knot-context-chart-legend">{bands.map(band => <span key={band.key}>
        <i style={{ background: band.color }} /><span>{band.label}</span><strong>{percent(point.breakdown?.find(row => row.key === band.key)?.share ?? 0)}</strong>
      </span>)}</div>}
  </section>
}
