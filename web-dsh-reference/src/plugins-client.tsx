import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginAnalyticsDto } from '../../src/workbench/plugin-analytics.js'
import { download, Metric, Panel, percent, useRead, type ViewProps } from './inspection-view.tsx'
import { descending } from './inspection-order.ts'

function PluginsView({ sessionId }: ViewProps) {
  const { value, error, refresh } = useRead<PluginAnalyticsDto>('knot/plugins', { sessionId })
  return <Panel title="插件与协议" note="当前 Assembly 的声明 × 本会话事实 · 订阅匹配不是实际处理次数，不归因输出" error={error} refresh={refresh}
    actions={value && <Button onClick={() => download(`knot-plugins-${sessionId}.json`, value)}>导出订阅匹配</Button>}>
    {!value ? <p>读取插件声明…</p> : !value.assembly ? <p>Host 没有此 Assembly 的元数据，匹配次数未知，不按零处理。</p> : <>
      <div className="knot-metrics"><Metric label="当前 Assembly">{value.assembly.title}</Metric><Metric label="插件">{value.plugins.length}</Metric>
        <Metric label="Journal 事实">{value.eventCount}</Metric><Metric label="协议类型">{value.protocols.length}</Metric></div>
      <p className="knot-inspection-note">按订阅匹配次数排序；序号仍是原注册顺序。这不是历史代码快照，不能判断 handler 是否运行、提前返回或抛错。同一插件总数去重；覆盖率 = 匹配 / 全部事实，各插件可重叠，不合计为 100%。</p>
      <div className="knot-plugin-grid">{descending(value.plugins, plugin => plugin.matchedEvents).map(plugin => <article className="knot-plugin-card" key={plugin.id}>
        <header><span className="knot-plugin-order" title="注册顺序">{value.plugins.indexOf(plugin) + 1}</span><h3>{plugin.name}</h3><Pill>{plugin.category}</Pill></header>
        <p className="knot-plugin-purpose">{plugin.responsibility}</p><div className="knot-plugin-matches"><strong>{plugin.matchedEvents.toLocaleString()}</strong> 个订阅匹配事实 · 覆盖 {percent(value.eventCount ? plugin.matchedEvents / value.eventCount : undefined)}</div>
        <div className="knot-subscriptions">{descending(plugin.subscriptions, item => item.count).map(item => <div key={item.type}><code>{item.type}</code><strong>{item.count.toLocaleString()}</strong></div>)}</div>
        {!plugin.subscriptions.length && <p className="knot-inspection-note">无声明订阅。</p>}
        <details className="knot-data"><summary>声明 / 源码位置</summary><p><code>{plugin.id}</code></p><p><code>{plugin.source}</code></p>
          <p>声明输出（不做次数归因）：<code>{plugin.emits.join(', ') || '—'}</code></p></details>
      </article>)}</div>
      <h3>协议输入分布</h3><div className="knot-table-scroll"><table className="knot-inspection-table"><thead><tr><th>协议</th><th>事实数</th><th>声明订阅者</th></tr></thead>
        <tbody>{descending(value.protocols, item => item.events).map(item => <tr key={item.type}><td><code>{item.type}</code></td><td>{item.events}</td>
          <td>{item.subscribers.join(' · ') || '无声明订阅者（合法）'}</td></tr>)}</tbody></table></div>
    </>}
  </Panel>
}
export const inject = ['slots']
export function apply(ctx: any) {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'knot-plugins', order: 50,
    label: () => '插件与协议', inject: (sessionId: string) => ({ sessionId }) }, PluginsView))
}
