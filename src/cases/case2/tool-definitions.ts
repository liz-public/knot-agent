import type { ToolDefinition } from '../case1/tools.js'
import { codingTools, type ToolOutput } from './coding-tools.js'
import { goalTool } from './goal-tool.js'
import { spawnAgentTool, type SubagentFactory } from './subagent-tool.js'
import { todoTool } from './todo-tool.js'
import {
  askTool,
  permissionTools,
  type ApprovalPort,
  type AskPort,
  type PermissionPolicy,
} from './tool-interaction.js'

export interface Case2ToolOptions {
  readonly cwd: string
  readonly toolOutput?: ToolOutput
  readonly permissionPolicy?: PermissionPolicy
  readonly approvalPort?: ApprovalPort
  readonly askPort?: AskPort
  readonly extraTools?: readonly ToolDefinition[]
  readonly subagentFactory?: SubagentFactory
}

export function case2ToolDefinitions(options: Case2ToolOptions): readonly ToolDefinition[] {
  const base = [
    ...codingTools(options.cwd, options.toolOutput),
    todoTool(),
    goalTool(),
    ...(options.subagentFactory === undefined
      ? []
      : [spawnAgentTool(options.cwd, options.subagentFactory)]),
    ...(options.extraTools ?? []),
  ]
  return permissionTools(
    [...base, ...(options.askPort === undefined ? [] : [askTool(options.askPort)])],
    options.permissionPolicy,
    options.approvalPort,
  )
}
