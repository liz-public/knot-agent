import { createCliCatalog, type CliCatalog } from './cli.js'
import { mockAndroidCliCommands } from './mock-android-tools.js'
import { createAndroidDeviceSession, type ToolDefinition } from './tools.js'

export interface Case1Tools {
  readonly cli: CliCatalog
  readonly tools: readonly ToolDefinition[]
}

export function case1ToolDefinitions(): Case1Tools {
  const device = createAndroidDeviceSession()
  const cli = createCliCatalog(mockAndroidCliCommands(device))
  return { cli, tools: [cli.bash] }
}
