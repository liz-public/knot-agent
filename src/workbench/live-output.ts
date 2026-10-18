import type { LiveOutput } from '../agent/plugins/llm.js'
import type { LiveSessionEvent } from './session.js'

export const workbenchLiveOutput = (
  emit: (event: LiveSessionEvent) => void,
): LiveOutput => ({
  open(meta) {
    emit({ kind: 'generation.open', ...meta })
    return {
      write(update) {
        emit({ kind: 'generation.update', requestId: meta.requestId, update })
      },
      close() {
        emit({ kind: 'generation.close', requestId: meta.requestId })
      },
    }
  },
})
