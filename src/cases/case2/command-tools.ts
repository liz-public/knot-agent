import type { ToolDefinition } from '../../agent/plugins/tools.js'
import { COMMAND_WAIT_MS, type CommandProcesses } from './command-process.js'

const waitParameter = { type: 'integer', minimum: 0, maximum: COMMAND_WAIT_MS,
  description: 'Maximum wait in milliseconds, not an execution timeout. Defaults to 10000; zero returns immediately.' }

export const COMMAND_TOOL_SCHEMAS = {
  "bash": { type: 'function', function: { name: 'bash', description: 'Start a shell command in the workspace. If still running after yieldMs, return a processId and nextCursor; use process.wait or process.stop. Only completed with exitCode 0 means success.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, yieldMs: waitParameter }, required: ['command'], additionalProperties: false } } },
  "process.wait": { type: 'function', function: { name: 'process.wait', description: 'Read incremental stdout/stderr from a process started by this runtime. Pass its nextCursor as cursor to avoid repeated output. Wait ends on new output, completion, or waitMs; it never restarts the command.',
    parameters: { type: 'object', properties: { processId: { type: 'string' }, cursor: { type: 'integer', minimum: 0 }, waitMs: waitParameter }, required: ['processId', 'cursor'], additionalProperties: false } } },
  "process.stop": { type: 'function', function: { name: 'process.stop', description: 'Request normal termination of the shell command and its process group in this runtime. Does not control arbitrary OS PIDs. A running result means termination has not been confirmed.',
    parameters: { type: 'object', properties: { processId: { type: 'string' } }, required: ['processId'], additionalProperties: false } } }
}

export function commandTools(processes: CommandProcesses): readonly ToolDefinition[] {
  const text = (args: Record<string, unknown>, key: string) => {
    if (typeof args[key] !== 'string' || !args[key]) throw new TypeError(`${key} must be a non-empty string`)
    return args[key] as string
  }
  const define = (name: keyof typeof COMMAND_TOOL_SCHEMAS, execute: ToolDefinition['execute']): ToolDefinition =>
    ({ name, execute, schema: COMMAND_TOOL_SCHEMAS[name] })
  return [
    define('bash', async (args, context) => ({
        content: JSON.stringify(await processes.start(text(args, 'command'), context, args['yieldMs'] as number | undefined)),
      })),
    define('process.wait', async args => ({
        content: JSON.stringify(await processes.wait(text(args, 'processId'), args['cursor'] as number, args['waitMs'] as number | undefined)),
      })),
    define('process.stop', async args => ({ content: JSON.stringify(await processes.stop(text(args, 'processId'))) })),
  ]
}
