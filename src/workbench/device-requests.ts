import { randomUUID } from 'node:crypto'
import type { DevicePort } from '../device/port.js'

export interface DeviceRequest {
  readonly operationId: string
  readonly capability: string
  readonly arguments: Record<string, unknown>
  readonly turnId: string
  readonly callId?: string
}

/** Per-session transport waiters. Never persisted or replayed as executable Journal events. */
export function createDeviceRequests(timeoutMs = 60_000) {
  let executor: ((request: DeviceRequest) => void) | undefined
  const pending = new Map<string, { resolve(value: Record<string, unknown>): void; timer: ReturnType<typeof setTimeout> }>()
  function settle(id: string, value: Record<string, unknown>) {
    const item = pending.get(id)
    if (!item) return false
    pending.delete(id); clearTimeout(item.timer); item.resolve(value)
    return true
  }
  const port: DevicePort = {
    request(capability, arguments_, context) {
      if (!executor) return Promise.resolve({ ok: false, error: 'device_unavailable' })
      const operationId = randomUUID()
      return new Promise(resolve => {
        const timer = setTimeout(() => settle(operationId, { ok: false, error: 'device_outcome_unknown' }), timeoutMs)
        pending.set(operationId, { resolve, timer })
        try { executor!({ operationId, capability, arguments: arguments_, ...context }) }
        catch { settle(operationId, { ok: false, error: 'device_outcome_unknown' }) }
      })
    },
  }
  return {
    port, settle,
    attach(listener: (request: DeviceRequest) => void) {
      if (executor) throw new Error('Session already has a device executor')
      executor = listener
      return () => {
        if (executor !== listener) return
        executor = undefined
        for (const id of pending.keys()) settle(id, { ok: false, error: 'device_outcome_unknown' })
      }
    },
  }
}
