export * from '../../agent/plugins/tools.js'

// The candidate list lives on the device, not in this process and not in the
// Journal. The Journal records only what the agent observed about that device.
export interface AndroidDeviceSession {
  pendingContact?: string
  flashlightOn: boolean
  ringerMode: 'normal' | 'silent' | 'vibrate'
  doNotDisturb: boolean
  volumes: Record<'music' | 'ring' | 'alarm' | 'notification', number>
  brightnessPercent: number
  clipboardText?: string
}

export const createAndroidDeviceSession = (): AndroidDeviceSession => ({
  flashlightOn: false,
  ringerMode: 'normal',
  doNotDisturb: false,
  volumes: { music: 50, ring: 50, alarm: 50, notification: 50 },
  brightnessPercent: 50,
})
