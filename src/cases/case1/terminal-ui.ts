import type { LiveOutput } from './llm.js'
import type { OutputSinks } from './output.js'

/**
 * One terminal adapter exposes two faces: a transient live port and the normal
 * final-event sinks. Preview text never enters the journal; the final sink
 * suppresses a byte-identical answer that was already rendered live.
 */
export function createTerminalUi(interactive: boolean): {
  readonly live: LiveOutput
  readonly output: OutputSinks
} {
  const renderedContent: string[] = []
  const renderedReasoning: string[] = []

  function consumeRendered(rendered: string[], content: string): boolean {
    const index = rendered.indexOf(content)
    if (index < 0) return false
    rendered.splice(index, 1)
    return true
  }

  return {
    live: {
      open(meta) {
        if (meta.purpose !== 'agent') return undefined
        let content = ''
        let reasoning = ''
        return {
          write(update) {
            if (update.kind === 'content') {
              if (content.length === 0) process.stdout.write(interactive ? 'assistant> ' : '')
              content += update.text
              process.stdout.write(update.text)
            } else {
              if (reasoning.length === 0) process.stderr.write('[reasoning] ')
              reasoning += update.text
              process.stderr.write(update.text)
            }
          },
          close() {
            if (content.length > 0) {
              process.stdout.write('\n')
              renderedContent.push(content)
            }
            if (reasoning.length > 0) {
              process.stderr.write('\n')
              renderedReasoning.push(reasoning)
            }
          },
        }
      },
    },
    output: {
      reasoning(content) {
        if (!consumeRendered(renderedReasoning, content)) {
          process.stderr.write(`[reasoning] ${content}\n`)
        }
      },
      content(content) {
        if (!consumeRendered(renderedContent, content)) {
          process.stdout.write(`${interactive ? 'assistant> ' : ''}${content}\n`)
        }
      },
    },
  }
}
