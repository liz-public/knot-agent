export interface ContactCandidate {
  readonly ordinal_1based: number
  readonly display_name: string
  readonly phone?: string
}

export interface MapPlaceTip {
  readonly name: string
  readonly location: string
  readonly district?: string
  readonly address?: string
  readonly distance_meters?: number
  readonly distance_label?: string
}

export type PendingSelection =
  | { readonly kind: 'contact'; readonly candidates: readonly ContactCandidate[] }
  | { readonly kind: 'map_navi'; readonly nav_mode: string; readonly user_location: string; readonly tips: readonly MapPlaceTip[] }
  | { readonly kind: 'map_route'; readonly route_type: string; readonly user_location: string; readonly origin_location: string; readonly origin_name: string; readonly tips: readonly MapPlaceTip[] }
  | { readonly kind: 'map_nearby'; readonly tips: readonly MapPlaceTip[] }

export interface AdbDeviceSession {
  pending: PendingSelection | undefined
}

export function createAdbDeviceSession(): AdbDeviceSession {
  return { pending: undefined }
}
