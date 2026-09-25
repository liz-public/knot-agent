export interface SettingsEntry {
  readonly id: string
  readonly label: string
  readonly aliases: readonly string[]
  readonly action: string
}

const ENTRIES: readonly SettingsEntry[] = [
  { id: 'wifi', label: 'Wi‑Fi', aliases: ['wifi', 'wlan', '无线', '无线网络'], action: 'android.settings.WIFI_SETTINGS' },
  { id: 'bluetooth', label: '蓝牙', aliases: ['蓝牙', 'bluetooth', '蓝牙设置'], action: 'android.settings.BLUETOOTH_SETTINGS' },
  { id: 'hotspot', label: '热点', aliases: ['热点', '个人热点', '网络共享', 'wifi热点'], action: 'android.settings.WIRELESS_SETTINGS' },
  { id: 'location', label: '定位', aliases: ['定位', '位置', 'gps', '位置信息'], action: 'android.settings.LOCATION_SOURCE_SETTINGS' },
  { id: 'display', label: '显示', aliases: ['显示', '屏幕', '显示设置'], action: 'android.settings.DISPLAY_SETTINGS' },
  { id: 'dark_theme', label: '深色模式', aliases: ['深色', '暗色', '夜间模式', '深色模式'], action: 'android.settings.DISPLAY_SETTINGS' },
  { id: 'sound', label: '声音', aliases: ['声音', '音量', '提示音'], action: 'android.settings.SOUND_SETTINGS' },
  { id: 'notification', label: '通知', aliases: ['通知', '通知管理'], action: 'android.settings.APP_NOTIFICATION_SETTINGS' },
  { id: 'battery', label: '电池', aliases: ['电池', '电量'], action: 'android.settings.BATTERY_SAVER_SETTINGS' },
  { id: 'battery_saver', label: '省电模式', aliases: ['省电', '省电模式', '节电'], action: 'android.settings.BATTERY_SAVER_SETTINGS' },
  { id: 'storage', label: '存储', aliases: ['存储', '内存', '空间'], action: 'android.settings.INTERNAL_STORAGE_SETTINGS' },
  { id: 'apps', label: '应用', aliases: ['应用', '应用管理', '应用程序'], action: 'android.settings.APPLICATION_SETTINGS' },
  { id: 'accessibility', label: '无障碍', aliases: ['无障碍', '辅助功能'], action: 'android.settings.ACCESSIBILITY_SETTINGS' },
  { id: 'security', label: '安全', aliases: ['安全', '锁屏', '指纹', '密码'], action: 'android.settings.SECURITY_SETTINGS' },
  { id: 'locale', label: '语言', aliases: ['语言', '系统语言'], action: 'android.settings.LOCALE_SETTINGS' },
  { id: 'input_method', label: '输入法', aliases: ['输入法', '键盘'], action: 'android.settings.INPUT_METHOD_SETTINGS' },
  { id: 'date_time', label: '日期与时间', aliases: ['日期', '时间', '时区'], action: 'android.settings.DATE_SETTINGS' },
  { id: 'system_update', label: '系统更新', aliases: ['系统更新', '软件更新', 'ota'], action: 'android.settings.SYSTEM_UPDATE_SETTINGS' },
  { id: 'nfc', label: 'NFC', aliases: ['nfc', '近场'], action: 'android.settings.NFC_SETTINGS' },
  { id: 'vpn', label: 'VPN', aliases: ['vpn'], action: 'android.settings.VPN_SETTINGS' },
  { id: 'settings_home', label: '设置首页', aliases: ['设置', '系统设置', '手机设置'], action: 'android.settings.SETTINGS' },
]

function normalize(text: string): string {
  return text.trim().toLowerCase()
    .replaceAll('wi-fi', 'wifi')
    .replaceAll('wi‑fi', 'wifi')
    .replace(/[\s\-_/·]+/g, '')
}

function fuzzyScore(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0
  let i = 0
  let j = 0
  let hits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      hits += 1
      i += 1
      j += 1
    } else {
      j += 1
    }
  }
  return hits >= 2 ? hits * 5 : 0
}

export function resolveSettingsPage(keyword: string): SettingsEntry | undefined {
  const norm = normalize(keyword)
  if (norm.length === 0) return undefined
  for (const entry of ENTRIES) {
    if (normalize(entry.id) === norm || entry.aliases.some(alias => normalize(alias) === norm)) return entry
  }
  return undefined
}

export function suggestSettingsPages(keyword: string, limit = 8): readonly SettingsEntry[] {
  const norm = normalize(keyword)
  if (norm.length === 0) return ENTRIES.slice(0, limit)
  return [...ENTRIES]
    .map(entry => ({
      entry,
      score: entry.aliases.reduce((max, alias) => Math.max(max, fuzzyScore(norm, normalize(alias))), 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(item => item.entry)
}
