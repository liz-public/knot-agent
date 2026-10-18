import type { ToolOutput } from '../cases/case2/command-process.js'
import type { LiveSessionEvent } from './session.js'

export const workbenchToolOutput = (
  emit: (event: LiveSessionEvent) => void,
): ToolOutput => ({
  open(meta) {
    emit({ kind: 'tool.open', ...meta })
    return {
      write(update) {
        emit({ kind: 'tool.update', callId: meta.callId, update })
      },
      close(result) {
        emit({ kind: 'tool.close', callId: meta.callId, ...result })
      },
    }
  },
})
