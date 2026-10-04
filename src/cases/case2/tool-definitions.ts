import type { ToolDefinition } from '../../agent/plugins/tools.js'
import { webSearchTool } from '../../agent/tools/web-search.js'
import type { WebSearchProvider } from '../../agent/providers/deepseek-search.js'
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
  readonly approvalMode?: () => 'ask' | 'auto'
  readonly askPort?: AskPort
  readonly extraTools?: readonly ToolDefinition[]
  readonly webSearch?: WebSearchProvider
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
    ...(options.webSearch === undefined ? [] : [webSearchTool(options.webSearch)]),
  ]
  return permissionTools(
    [...base, ...(options.askPort === undefined ? [] : [askTool(options.askPort)])],
    options.permissionPolicy,
    options.approvalPort,
    options.approvalMode,
  )
}
