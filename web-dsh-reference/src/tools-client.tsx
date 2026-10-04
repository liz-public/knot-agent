import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolAnalyticsDto } from '../../src/workbench/tool-analytics.js'
import { download, Metric, Panel, percent, useRead, type ViewProps } from './inspection-view.tsx'
import { descending } from './inspection-order.ts'

function ToolsView({ sessionId, useProjection, openView }: ViewProps) {
  const { value, error, refresh } = useRead<ToolAnalyticsDto>('knot/tools', { sessionId }, useProjection('knotEventCount'))
  return <Panel title="工具统计" note="全会话的注册工具与调用事实 · 零调用保留，不代表工具应该被使用" error={error} refresh={refresh}
    actions={value && <Button onClick={() => download(`knot-tools-${sessionId}.json`, value)}>导出 JSON</Button>}>
    {!value ? <p>读取工具统计…</p> : <>
      <div className="knot-metrics"><Metric label="调用次数">{value.totalCalls}</Metric><Metric label="注册工具">{value.registeredTools}</Metric>
        <Metric label="工具使用覆盖率">{percent(value.registeredTools ? value.usedRegisteredTools / value.registeredTools : undefined)}</Metric>
        <Metric label="未使用的注册工具">{value.registeredTools - value.usedRegisteredTools}</Metric></div>
      <p className="knot-inspection-note">调用占比 = 该工具 / 全部调用；明确结果成功率 = 成功 /（成功 + 失败）。未知与未返回不算失败。</p>
      {!value.tools.length ? <p>Journal 尚无注册或调用工具。</p> : <div className="knot-table-scroll"><table className="knot-inspection-table">
        <thead><tr>{['工具 / 能力', '调用', '调用占比', '明确结果成功率', '返回', '失败', '未知', '未返回', '批次平均等待'].map(text => <th key={text}>{text}</th>)}</tr></thead>
        <tbody>{descending(value.tools, row => row.calls).map(row => <tr key={row.name} data-unused={row.calls === 0 || undefined}>
          <td><button onClick={() => openView('knot-inspection', 'tool:' + row.name)}>{row.name}</button>
            <p className="knot-tool-description">{row.description ?? 'Journal 中没有该工具的描述。'}</p>
            {!row.registered ? <Pill>未记录注册</Pill> : !row.available ? <Pill>历史注册 · 当前未列出</Pill> : row.calls === 0 ? <Pill>未调用</Pill> : null}</td>
          <td>{row.calls}</td><td><div className="knot-share"><span>{percent(row.callShare)}</span>
            <progress aria-label={`${row.name} 调用占比`} max={1} value={row.callShare ?? 0} /></div></td>
          <td>{percent(row.successRate)}</td>{[row.returned, row.failed, row.unknown, row.unfinished].map((n, i) => <td key={i}>{n}</td>)}
          <td>{row.timedBatches ? `${(row.totalBatchWaitMs / row.timedBatches / 1000).toFixed(2)}s` : '—'}
            {row.timedBatches > 0 && <small>{row.timedBatches} 批</small>}</td>
        </tr>)}</tbody></table></div>}
      <p className="knot-inspection-note">状态是工具结果的明确报告，不证明外部副作用成功。等待包括并行批次与审批，不是单工具执行时间。仅统计当前 Session。</p>
    </>}
  </Panel>
}
export const inject = ['slots']
export function apply(ctx: any) {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'knot-tools', order: 30,
    label: () => '工具统计', inject: (sessionId: string) => ({ sessionId }) }, ToolsView))
}
