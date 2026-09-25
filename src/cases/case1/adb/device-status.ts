import type { AdbExecutor } from './executor.js'

const ALL_FIELDS = new Set([
  'device', 'battery', 'storage', 'memory', 'network', 'bluetooth',
  'brightness', 'volume', 'ringer', 'display', 'power',
])

export function parseDeviceStatusFields(raw: unknown): Set<string> {
  if (typeof raw !== 'string' || raw.trim().length === 0) return ALL_FIELDS
  const text = raw.trim().toLowerCase()
  if (text === 'all') return ALL_FIELDS
  const fields = text.split(/[,\s，]+/).map(item => item.trim()).filter(Boolean)
  return fields.length === 0 ? ALL_FIELDS : new Set(fields)
}

function parseBatteryLevel(text: string): number | undefined {
  const match = /level:\s*(\d+)/i.exec(text)
  if (match === null) return undefined
  const level = Number(match[1])
  return Number.isFinite(level) ? level : undefined
}

function parseBatteryStatus(text: string): Record<string, unknown> {
  const readNumber = (pattern: RegExp) => {
    const match = pattern.exec(text)
    if (match === null) return undefined
    const value = Number(match[1])
    return Number.isFinite(value) ? value : undefined
  }
  return {
    percent: parseBatteryLevel(text),
    status: readNumber(/status:\s*(\d+)/i),
    health: readNumber(/health:\s*(\d+)/i),
    temperature_tenth_c: readNumber(/temperature:\s*(\d+)/i),
    voltage_mv: readNumber(/voltage:\s*(\d+)/i),
    ac_powered: /AC powered:\s*true/i.test(text),
    usb_powered: /USB powered:\s*true/i.test(text),
    wireless_powered: /Wireless powered:\s*true/i.test(text),
  }
}

function parseMeminfo(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const match = /^([^:]+):\s*(\d+)\s*kB/i.exec(line)
    if (match === null) continue
    out[match[1]!.trim().toLowerCase().replace(/\s+/g, '_')] = Number(match[2]!) * 1024
  }
  return out
}

function parseVolumePercent(text: string): number | undefined {
  const match = /volume is\s+(\d+)\s+in range\s+\[(\d+)\.\.(\d+)\]/i.exec(text)
  if (match === null) return undefined
  const current = Number(match[1])
  const min = Number(match[2])
  const max = Number(match[3])
  if (!Number.isFinite(current) || max <= min) return undefined
  return Math.round((current - min) / (max - min) * 100)
}

export async function readDeviceStatus(
  executor: AdbExecutor,
  fields: Set<string>,
): Promise<Record<string, unknown>> {
  const want = fields.size === 0 ? ALL_FIELDS : fields
  const out: Record<string, unknown> = {}

  if (want.has('device')) {
    out['device'] = {
      manufacturer: await executor.shell('getprop ro.product.manufacturer'),
      brand: await executor.shell('getprop ro.product.brand'),
      model: await executor.shell('getprop ro.product.model'),
      android_release: await executor.shell('getprop ro.build.version.release'),
      sdk_int: Number(await executor.shell('getprop ro.build.version.sdk')),
    }
  }

  if (want.has('battery')) {
    out['battery'] = parseBatteryStatus(await executor.shell('dumpsys battery'))
  }

  if (want.has('storage')) {
    const df = await executor.shell('df -k /data')
    const line = df.split('\n').find(item => item.includes('/data')) ?? ''
    const parts = line.trim().split(/\s+/).filter(Boolean)
    const totalKb = Number(parts[1])
    const usedKb = Number(parts[2])
    const availKb = Number(parts[3])
    out['storage'] = {
      total_bytes: Number.isFinite(totalKb) ? totalKb * 1024 : undefined,
      used_bytes: Number.isFinite(usedKb) ? usedKb * 1024 : undefined,
      available_bytes: Number.isFinite(availKb) ? availKb * 1024 : undefined,
    }
  }

  if (want.has('memory')) {
    const mem = parseMeminfo(await executor.shell('cat /proc/meminfo'))
    const total = mem['memtotal']
    const available = mem['memavailable'] ?? mem['memfree']
    out['memory'] = {
      total_bytes: total,
      available_bytes: available,
      ...(total !== undefined && available !== undefined
        ? { used_bytes: total - available }
        : {}),
    }
  }

  if (want.has('network')) {
    const wifi = await executor.shell('dumpsys wifi | grep -m 1 "Wi-Fi is"')
    const connectivity = await executor.shell('dumpsys connectivity | grep -m 1 "Active default network"')
    out['network'] = {
      wifi_line: wifi,
      active_network_line: connectivity,
      wifi_enabled: /Wi-Fi is enabled/i.test(wifi),
      airplane_mode: (await executor.shell('settings get global airplane_mode_on')) === '1',
    }
  }

  if (want.has('bluetooth')) {
    const text = await executor.shell('dumpsys bluetooth_manager | grep -m 1 "enabled:"')
    out['bluetooth'] = {
      enabled: /enabled:\s*true/i.test(text),
      state_line: text,
    }
  }

  if (want.has('brightness')) {
    const raw = Number(await executor.shell('settings get system screen_brightness'))
    const mode = Number(await executor.shell('settings get system screen_brightness_mode'))
    out['brightness'] = {
      percent: Number.isFinite(raw) ? Math.round(raw / 255 * 100) : undefined,
      raw_0_255: Number.isFinite(raw) ? raw : undefined,
      auto_brightness: mode === 1,
    }
  }

  if (want.has('volume')) {
    const streams = ['music', 'ring', 'alarm', 'notification'] as const
    const streamIds: Record<typeof streams[number], number> = {
      music: 3,
      ring: 2,
      alarm: 4,
      notification: 5,
    }
    const volume: Record<string, { percent?: number }> = {}
    for (const stream of streams) {
      const text = await executor.shell(`cmd media_session volume --stream ${streamIds[stream]} --get`)
      volume[stream] = { percent: parseVolumePercent(text) }
    }
    out['volume'] = volume
  }

  if (want.has('ringer')) {
    const mode = (await executor.shell('cmd audio get-ringer-mode')).trim().toLowerCase()
    out['ringer'] = {
      mode: mode === 'normal' ? 'ring' : mode,
    }
  }

  if (want.has('display')) {
    const size = await executor.shell('wm size')
    const density = await executor.shell('wm density')
    const rotationAuto = await executor.shell('settings get system accelerometer_rotation')
    out['display'] = {
      size_line: size,
      density_line: density,
      rotation_auto: rotationAuto === '1',
    }
  }

  if (want.has('power')) {
    const text = await executor.shell('dumpsys power | grep -m 3 "mWakefulness\\|Power save mode"')
    out['power'] = {
      summary: text,
      power_save_mode: /power save mode:\s*true/i.test(text),
    }
  }

  return out
}
