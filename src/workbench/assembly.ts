import type { Plugin } from '../journal.js'
import type { LiveOutput } from '../cases/case1/llm.js'
import type { ApprovalPort, AskPort } from '../cases/case2/tool-interaction.js'

export interface SessionRuntime {
  submit(content: string): Promise<void>
  steer(content: string): void
  pause(): void
  resume(): void
  status(): 'idle' | 'running' | 'paused'
}

export interface AssemblyInput {
  readonly cwd: string
  readonly journalPath: string
  readonly liveOutput: LiveOutput
  readonly approvalPort: ApprovalPort
  readonly askPort: AskPort
  readonly platformPlugins: readonly Plugin[]
}

export interface AgentAssemblyFactory {
  readonly id: string
  readonly model: string
  create(input: AssemblyInput): Promise<SessionRuntime>
}
