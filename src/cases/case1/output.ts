import type { Plugin } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  ASSISTANT_REASONING,
  type AssistantMessage,
  type AssistantReasoning,
} from './protocol.js'

export interface OutputSinks {
  readonly content: (content: string) => void
  readonly reasoning?: (content: string) => void
}

export const outputPlugin = (sinks: OutputSinks): Plugin => journal => {
  journal.subscribe(ASSISTANT_REASONING, event => {
    sinks.reasoning?.((event.data as AssistantReasoning).content)
  })
  journal.subscribe(ASSISTANT_MESSAGE, event => {
    sinks.content((event.data as AssistantMessage).content)
  })
}
