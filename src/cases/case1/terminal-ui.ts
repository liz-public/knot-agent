import type { LiveOutput } from './llm.js'
import type { OutputSinks } from './output.js'

/**
 * One terminal adapter exposes two faces: a transient live port and the normal
 * final-event sinks. Preview text never enters the journal; the final sink
 * suppresses a byte-identical answer that was already rendered live.
 */
export function createTerminalUi(
  interactive: boolean,
  streams: {
    stdout: { write(text: string): unknown }
    stderr: { write(text: string): unknown }
  } = process,
): {
  readonly live: LiveOutput
  readonly output: OutputSinks
} {
  let renderedContent: string | undefined
  let renderedReasoning: string | undefined

  function consumeRendered(kind: 'content' | 'reasoning', content: string): boolean {
    if (kind === 'content') {
      if (renderedContent !== content) return false
      renderedContent = undefined
      return true
    }
    if (renderedReasoning !== content) return false
    renderedReasoning = undefined
    return true
  }

  return {
    live: {
      open(meta) {
        if (meta.purpose !== 'agent') return undefined
        // Only the current generation can later commit a matching semantic
        // event. Tool-call preambles from older generations are already shown
        // but must not accumulate or suppress an unrelated future answer.
        renderedContent = undefined
        renderedReasoning = undefined
        let content = ''
        let reasoning = ''
        return {
          write(update) {
            if (update.kind === 'content') {
              if (content.length === 0) streams.stdout.write(interactive ? 'assistant> ' : '')
              content += update.text
              streams.stdout.write(update.text)
            } else {
              if (reasoning.length === 0) streams.stderr.write('[reasoning] ')
              reasoning += update.text
              streams.stderr.write(update.text)
            }
          },
          close() {
            if (content.length > 0) {
              streams.stdout.write('\n')
              renderedContent = content
            }
            if (reasoning.length > 0) {
              streams.stderr.write('\n')
              renderedReasoning = reasoning
            }
          },
        }
      },
    },
    output: {
      reasoning(content) {
        if (!consumeRendered('reasoning', content)) {
          streams.stderr.write(`[reasoning] ${content}\n`)
        }
      },
      content(content) {
        if (!consumeRendered('content', content)) {
          streams.stdout.write(`${interactive ? 'assistant> ' : ''}${content}\n`)
        }
      },
    },
  }
}
