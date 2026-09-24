export interface ContactCandidate {
  readonly ordinal_1based: number
  readonly display_name: string
  readonly phone?: string
}

export interface PendingSelection {
  readonly source: 'contact' | 'navigation'
  readonly candidates: readonly ContactCandidate[]
}

export interface AdbDeviceSession {
  pending: PendingSelection | undefined
}

export function createAdbDeviceSession(): AdbDeviceSession {
  return { pending: undefined }
}
