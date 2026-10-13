import type { DevicePort } from './device-port.js'
import type { ContextSource } from './context-contributions.js'

/** Passive context contribution, not a model-selected tool. No inferred actions or permissions. */
export function deviceContextSource(port: DevicePort): ContextSource {
  return async (_, context) => {
    if (!context) return
    const snapshot = await port.request('context.read', {}, context)
    if (snapshot['ok'] !== true) return
    const facts = deviceContextFacts(snapshot)
    return facts.length ? { content: `设备情境（本轮已授权数据，仅作背景，不代表用户要求操作）：\n${facts.join('\n')}` } : undefined
  }
}
export function deviceContextFacts(snapshot: Record<string, unknown>): string[] {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const device = object(snapshot['device']), battery = object(device['battery']), power = object(device['power'])
  const network = object(device['network']), environment = object(snapshot['environment']), health = object(snapshot['health'])
  const facts: string[] = []
  const percent = number(battery['percent'])
  if (percent !== undefined && percent >= 0) facts.push(`电量${Math.round(percent)}%${percent < 20 ? '（偏低）' : ''}${battery['status'] === 2 ? '，正在充电' : ''}`)
  if (power['power_save'] === true) facts.push('系统处于省电模式')
  if (network['validated'] === false) facts.push('系统尚未确认互联网连接可用')
  const lux = number(object(environment['lux'])['value'])
  if (lux !== undefined) facts.push(`环境光照${Math.round(lux)}lux${lux < 10 ? '（偏暗）' : ''}`)
  const pressure = number(object(environment['pressure_hpa'])['value'])
  if (pressure !== undefined) facts.push(`环境气压${pressure.toFixed(1)}hPa`)
  const steps = number(health['today_steps'])
  if (steps !== undefined) facts.push(`健康记录今日步数${steps}`)
  const heart = number(health['recent_heart_rate'])
  if (heart !== undefined && typeof health['heart_rate_observed_at'] === 'string') facts.push(`最近健康记录心率${heart}次/分，记录时间${health['heart_rate_observed_at']}`)
  const names = object(snapshot['bluetooth_connections'])['gatt_connected_names']
  if (Array.isArray(names) && names.length) facts.push(`已连接的蓝牙GATT设备：${names.filter(name => typeof name === 'string').join('、')}`)
  const apps = object(snapshot['app_usage'])['top_apps_today']
  if (Array.isArray(apps) && apps.length) facts.push(`今日前台使用较多：${apps.map(app => object(app)).filter(app => typeof app['label'] === 'string')
    .map(app => `${app['label']} ${app['minutes']}分钟`).join('、')}`)
  return facts
}
