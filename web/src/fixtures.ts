export type PluginState = 'ready' | 'active' | 'optional'

export interface PluginFixture {
  readonly id: string
  readonly name: string
  readonly category: 'platform' | 'context' | 'flow' | 'content' | 'effect' | 'presentation'
  readonly responsibility: string
  readonly description: string
  readonly listens: readonly string[]
  readonly emits: readonly string[]
  readonly protocols: readonly string[]
  readonly version: string
  readonly author: string
  readonly state: PluginState
}

export interface CaseFixture {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly assembly: string
  readonly provider: 'mock' | 'real'
  readonly providerLabel: string
  readonly workspace: string
  readonly assertions: readonly string[]
  readonly runs: number
}

export interface ProtocolFixture {
  readonly name: string
  readonly kind: 'fact' | 'request' | 'effect' | 'platform'
  readonly summary: string
  readonly producer: string
  readonly consumers: string
  readonly fields: string
}

export const cases: readonly CaseFixture[] = [
  {
    id: 'case2-coding',
    title: 'CASE2 coding task',
    summary: 'Persistent coding agent with tools, guards, steering and approvals.',
    assembly: 'case2/coding-agent',
    provider: 'real',
    providerLabel: 'qwen3-coder',
    workspace: '/Users/lizhe/workspace/knot-agent',
    assertions: ['assistant.message', 'tool.result', 'workspace changed', 'tests pass'],
    runs: 8,
  },
  {
    id: 'guard-regression',
    title: 'Guard regression',
    summary: 'Checks that todo and goal guards intercept premature completion.',
    assembly: 'case2/guard-regression',
    provider: 'mock',
    providerLabel: 'deterministic mock',
    workspace: '/Users/lizhe/workspace/knot-agent/.fixtures/guard',
    assertions: ['todo guarded', 'goal guarded', 'completion emitted once'],
    runs: 3,
  },
  {
    id: 'tool-boundary',
    title: 'Tool boundary lab',
    summary: 'Exercises parallel calls, denial, failures and terminal rendering.',
    assembly: 'case2/tool-boundary',
    provider: 'mock',
    providerLabel: 'scripted mock',
    workspace: '/Users/lizhe/workspace/knot-agent/.fixtures/tools',
    assertions: ['batch ordering', 'failure returned', 'approval isolated'],
    runs: 5,
  },
]

export const plugins: readonly PluginFixture[] = [
  {
    id: 'controlled-boundary', name: 'ControlledEventBoundary', category: 'platform', state: 'ready', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Pause delivery only between complete Journal events.',
    description: 'Exposes graceful pause and resume above the Journal drain without changing event envelopes or handler semantics.',
    listens: ['*'], emits: [], protocols: ['journal.event'],
  },
  {
    id: 'jsonl-store', name: 'JSONLStorage', category: 'platform', state: 'ready', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Persist every delivered fact with observation metadata.',
    description: 'Writes append-only JSONL. observedAt belongs to the storage record and never becomes part of the Journal event.',
    listens: ['*'], emits: [], protocols: ['journal.event', 'storage.record'],
  },
  {
    id: 'system-prompt', name: 'CodingSystemPrompt', category: 'context', state: 'ready', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Install the stable coding-agent instruction once.',
    description: 'Contributes the cache-stable system instruction at session start.',
    listens: ['session.start'], emits: ['system.prompt'], protocols: ['system.prompt'],
  },
  {
    id: 'workspace-context', name: 'WorkspaceContext', category: 'context', state: 'ready', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Describe the selected workspace for the active user turn.',
    description: 'Emits one dynamic context fact scoped to the current turn. Older dynamic contexts remain auditable but are not projected.',
    listens: ['user.message'], emits: ['context.dynamic'], protocols: ['context.dynamic'],
  },
  {
    id: 'history-compression', name: 'CompressHistory', category: 'context', state: 'optional', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Replace projected history with a semantic checkpoint near the model limit.',
    description: 'Observes model usage and asks the content path for a summary only after the configured threshold is crossed.',
    listens: ['llm.generated'], emits: ['history.compress.request', 'history.checkpoint'], protocols: ['llm.generated', 'history.checkpoint'],
  },
  {
    id: 'coding-flow', name: 'CodingFlow', category: 'flow', state: 'active', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Turn user and tool facts into the next content request.',
    description: 'Owns only coding turn progression, steering convergence and completion publication. Tool execution and model generation remain outside.',
    listens: ['user.message', 'tool.result', 'llm.generated'], emits: ['content.request', 'assistant.message'], protocols: ['content.request', 'assistant.message'],
  },
  {
    id: 'content', name: 'ContentSources', category: 'content', state: 'active', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Select the first registered source that can answer a content request.',
    description: 'Registration order defines precedence. CASE2 currently installs one LLM source; tests can replace it with a deterministic mock.',
    listens: ['content.request'], emits: ['llm.request'], protocols: ['content.request', 'llm.request'],
  },
  {
    id: 'context-assembler', name: 'ContextAssembler', category: 'content', state: 'ready', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Project Journal facts into one provider-neutral model request.',
    description: 'Selects the latest checkpoint, stable prompt, current dynamic context, conversation facts and registered tool definitions.',
    listens: ['llm.request'], emits: ['llm.invoke'], protocols: ['llm.request', 'llm.invoke'],
  },
  {
    id: 'llm', name: 'LLMProvider', category: 'content', state: 'active', version: '0.1.0', author: 'Provider package',
    responsibility: 'Produce one complete model decision and transient stream updates.',
    description: 'Provider adaptation is isolated here. Streaming uses an out-of-band LiveOutput port; the completed decision is one Journal fact.',
    listens: ['llm.invoke'], emits: ['llm.generated', 'assistant.reasoning', 'tool.call'], protocols: ['llm.invoke', 'llm.generated', 'live.output'],
  },
  {
    id: 'tools', name: 'Tools', category: 'effect', state: 'active', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Execute one tool-call batch and return every outcome.',
    description: 'Owns tool discovery, approval wrapping, parallel execution and conversion of thrown errors into model-visible results.',
    listens: ['tool.call'], emits: ['tool.result'], protocols: ['tool.registry', 'tool.call', 'tool.result'],
  },
  {
    id: 'output', name: 'Output', category: 'presentation', state: 'ready', version: '0.1.0', author: 'Knot core team',
    responsibility: 'Publish committed assistant replies to the selected surface.',
    description: 'A thin presentation sink. Web streaming is separate and cannot alter Journal delivery.',
    listens: ['assistant.message'], emits: [], protocols: ['assistant.message'],
  },
]

export const protocols: readonly ProtocolFixture[] = [
  { name: 'user.message', kind: 'fact', summary: 'A durable user instruction for one turn.', producer: 'Input surface', consumers: 'WorkspaceContext · CodingFlow', fields: 'turnId · content' },
  { name: 'context.dynamic', kind: 'fact', summary: 'Turn-scoped environment and runtime context.', producer: 'WorkspaceContext', consumers: 'ContextAssembler', fields: 'turnId · content' },
  { name: 'content.request', kind: 'request', summary: 'Requests one content source decision.', producer: 'CodingFlow', consumers: 'ContentSources', fields: 'turnId · query' },
  { name: 'llm.request', kind: 'request', summary: 'Requests provider-neutral model projection.', producer: 'ContentSources · CodingFlow', consumers: 'ContextAssembler', fields: 'turnId · purpose' },
  { name: 'llm.invoke', kind: 'request', summary: 'A projected provider call plus reproducibility manifest.', producer: 'ContextAssembler', consumers: 'LLMProvider', fields: 'requestId · request · manifest' },
  { name: 'llm.generated', kind: 'fact', summary: 'One complete model decision and usage.', producer: 'LLMProvider', consumers: 'CodingFlow · CompressHistory', fields: 'requestId · generated · usage' },
  { name: 'tool.call', kind: 'effect', summary: 'One ordered batch of model-selected effects.', producer: 'LLMProvider', consumers: 'Tools', fields: 'turnId · sourceRequestId · calls[]' },
  { name: 'tool.result', kind: 'effect', summary: 'The complete result batch, including failures.', producer: 'Tools', consumers: 'CodingFlow', fields: 'turnId · results[]' },
  { name: 'assistant.message', kind: 'fact', summary: 'The durable user-visible completion.', producer: 'CodingFlow', consumers: 'Output', fields: 'turnId · content' },
  { name: 'live.output', kind: 'platform', summary: 'Transient presentation updates outside Journal.', producer: 'LLMProvider', consumers: 'Web · CLI', fields: 'requestId · kind · delta' },
]

export const contextMessages = [
  { role: 'system', tokens: 612, text: 'You are Knot, a coding agent working inside the selected workspace…', source: 'CodingSystemPrompt' },
  { role: 'tools', tokens: 846, text: 'read · write · edit · bash · todo · goal · ask', source: 'Tools registry' },
  { role: 'user', tokens: 26, text: 'Run the tests, identify the failure, and make the smallest safe correction.', source: 'Journal projection' },
  { role: 'dynamic', tokens: 84, text: 'Workspace: /Users/lizhe/workspace/knot-agent · branch: main · goal: active · todo: 1 open', source: 'WorkspaceContext' },
  { role: 'assistant', tokens: 41, text: 'I will inspect the failing test first.', source: 'Journal projection', tool: 'bash' },
  { role: 'tool', tokens: 139, text: 'exitCode: 1\nAssertionError: expected 3 events, received 4…', source: 'Journal projection' },
] as const

export const sequence = [
  { from: 'Web input', event: 'user.message', to: 'WorkspaceContext + CodingFlow', note: 'durable fact' },
  { from: 'WorkspaceContext', event: 'context.dynamic', to: 'ContextAssembler', note: 'current turn only' },
  { from: 'CodingFlow', event: 'content.request', to: 'ContentSources', note: 'request content' },
  { from: 'ContentSources', event: 'llm.request', to: 'ContextAssembler', note: 'provider selected' },
  { from: 'ContextAssembler', event: 'llm.invoke', to: 'LLMProvider', note: 'projected input' },
  { from: 'LLMProvider', event: 'tool.call', to: 'Tools', note: 'effect batch' },
  { from: 'Tools', event: 'tool.result', to: 'CodingFlow', note: 'all outcomes' },
  { from: 'CodingFlow', event: 'llm.request', to: 'ContextAssembler', note: 'continue turn' },
  { from: 'LLMProvider', event: 'llm.generated', to: 'CodingFlow', note: 'completion candidate' },
  { from: 'CodingFlow', event: 'assistant.message', to: 'Output', note: 'durable reply' },
] as const
