import type { Plugin } from '../journal.js'
import {
  ASSISTANT_MESSAGE,
  TOOL_CALL,
  TOOL_RESULT,
  USER_MESSAGE,
  type ToolResult,
} from '../protocol.js'

export const mockLlmPlugin = (): Plugin => journal => {
  journal.subscribe(USER_MESSAGE, () => {
    journal.append(TOOL_CALL, {
      callId: 'demo-call-1',
      name: 'demo_lookup',
      arguments: { name: 'knot-agent' },
    })
  })

  journal.subscribe(TOOL_RESULT, event => {
    const result = event.data as ToolResult
    journal.append(ASSISTANT_MESSAGE, {
      content: `Tool ${result.name} returned: ${JSON.stringify(result.output)}`,
    })
  })
}
