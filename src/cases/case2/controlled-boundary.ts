import type { Plugin } from '../../journal.js'

export interface EventBoundaryControl {
  pause(): void
  resume(): void
  status(): 'running' | 'paused'
}

export function controlledEventBoundary(): {
  readonly plugin: Plugin
  readonly control: EventBoundaryControl
} {
  let pauseRequested = false
  let paused = false
  let resume: (() => void) | undefined

  const control: EventBoundaryControl = {
    pause() {
      pauseRequested = true
    },
    resume() {
      pauseRequested = false
      resume?.()
      resume = undefined
    },
    status: () => paused ? 'paused' : 'running',
  }

  const plugin: Plugin = journal => {
    journal.subscribe('*', async () => {
      if (!pauseRequested) return
      paused = true
      try {
        await new Promise<void>(resolve => {
          resume = resolve
        })
      } finally {
        paused = false
      }
    })
  }

  return { plugin, control }
}
