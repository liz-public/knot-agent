import type { Plugin } from '../journal.js'

export interface GenerationOutput {
  open(meta: { readonly requestId: string; readonly turnId: string; readonly purpose: string }): {
    write(update: unknown): void | Promise<void>
    close(): void | Promise<void>
  } | undefined
}

export interface HostApprovalPort {
  request(input: {
    readonly toolName: string
    readonly arguments: Readonly<Record<string, unknown>>
  }): Promise<'allow' | 'deny'>
}

export interface HostAskPort {
  ask(input: {
    readonly question: string
    readonly choices?: readonly string[]
  }): Promise<{ readonly answer: string }>
}

export interface ToolOutput {
  open(meta: {
    readonly turnId: string
    readonly callId: string
    readonly toolName: string
    readonly command: string
  }): {
    write(update: { readonly stream: 'stdout' | 'stderr'; readonly text: string }): void | Promise<void>
    close(result: { readonly exitCode: number }): void | Promise<void>
  } | undefined
}

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
  readonly liveOutput: GenerationOutput
  readonly toolOutput: ToolOutput
  readonly approvalPort: HostApprovalPort
  readonly askPort: HostAskPort
  readonly platformPlugins: readonly Plugin[]
}

export interface AgentAssemblyFactory {
  readonly id: string
  readonly model: string
  create(input: AssemblyInput): Promise<SessionRuntime>
}
