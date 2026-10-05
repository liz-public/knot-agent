import type { ToolDefinition } from '../../agent/plugins/tools.js'
import { COMMAND_WAIT_MS, type CommandProcesses } from './command-process.js'

export function commandTools(processes: CommandProcesses): readonly ToolDefinition[] {
  const text = (args: Record<string, unknown>, key: string) => {
    if (typeof args[key] !== 'string' || !args[key]) throw new TypeError(`${key} must be a non-empty string`)
    return args[key] as string
  }
  const waitParameter = { type: 'integer', minimum: 0, maximum: COMMAND_WAIT_MS,
    description: 'Maximum wait in milliseconds, not an execution timeout. Defaults to 10000; zero returns immediately.' }
  const define = (name: string, description: string, properties: Record<string, unknown>, required: string[],
    execute: ToolDefinition['execute']): ToolDefinition => ({ name, execute,
      schema: { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } } })
  return [
    define('bash', 'Start a shell command in the workspace. If still running after yieldMs, return a processId and nextCursor; use process.wait or process.stop. Only completed with exitCode 0 means success.',
      { command: { type: 'string' }, yieldMs: waitParameter }, ['command'], async (args, context) => ({
        content: JSON.stringify(await processes.start(text(args, 'command'), context, args['yieldMs'] as number | undefined)),
      })),
    define('process.wait', 'Read incremental stdout/stderr from a process started by this runtime. Pass its nextCursor as cursor to avoid repeated output. Wait ends on new output, completion, or waitMs; it never restarts the command.',
      { processId: { type: 'string' }, cursor: { type: 'integer', minimum: 0 }, waitMs: waitParameter }, ['processId', 'cursor'], async args => ({
        content: JSON.stringify(await processes.wait(text(args, 'processId'), args['cursor'] as number, args['waitMs'] as number | undefined)),
      })),
    define('process.stop', 'Request normal termination of the shell command and its process group in this runtime. Does not control arbitrary OS PIDs. A running result means termination has not been confirmed.',
      { processId: { type: 'string' } }, ['processId'], async args => ({ content: JSON.stringify(await processes.stop(text(args, 'processId'))) })),
  ]
}
