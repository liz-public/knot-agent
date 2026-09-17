export interface TraceEvent {
  id: number
  type: string
  owner: string
  elapsed: string
  tone: 'neutral' | 'model' | 'tool' | 'success'
}

export interface PluginFixture {
  name: string
  responsibility: string
  listens: string
  emits: string
  state: 'ready' | 'active'
}

export const sessions = [
  { id: 'active', title: 'Refactor auth boundary', meta: 'CASE2 · running', active: true },
  { id: 'tests', title: 'Investigate flaky tests', meta: 'CASE2 · 18m', active: false },
  { id: 'android', title: 'Android tool routing', meta: 'CASE1 · yesterday', active: false },
]

export const trace: TraceEvent[] = [
  { id: 1, type: 'user.message', owner: 'Web input', elapsed: '+0ms', tone: 'neutral' },
  { id: 2, type: 'context.dynamic', owner: 'WorkspaceContext', elapsed: '+1ms', tone: 'neutral' },
  { id: 3, type: 'content.request', owner: 'CodingFlow', elapsed: '+1ms', tone: 'neutral' },
  { id: 4, type: 'llm.invoke', owner: 'LlmPlugin', elapsed: '+3ms', tone: 'model' },
  { id: 5, type: 'llm.generated', owner: 'qwen3-coder', elapsed: '+842ms', tone: 'model' },
  { id: 6, type: 'tool.call', owner: 'ToolsPlugin', elapsed: '+843ms', tone: 'tool' },
  { id: 7, type: 'tool.result', owner: 'bash', elapsed: '+1.36s', tone: 'tool' },
  { id: 8, type: 'llm.invoke', owner: 'LlmPlugin', elapsed: '+1.36s', tone: 'model' },
  { id: 9, type: 'assistant.message', owner: 'CodingFlow', elapsed: '+2.12s', tone: 'success' },
]

export const plugins: PluginFixture[] = [
  {
    name: 'WorkspaceContext',
    responsibility: 'Describe the current workspace for one user turn.',
    listens: 'user.message',
    emits: 'context.dynamic',
    state: 'ready',
  },
  {
    name: 'CodingFlow',
    responsibility: 'Request content and guard a candidate completion.',
    listens: 'user.message · tool.result · llm.generated',
    emits: 'content.request · llm.request · assistant.message',
    state: 'active',
  },
  {
    name: 'Content',
    responsibility: 'Choose the first content source that can answer.',
    listens: 'content.request',
    emits: 'llm.request',
    state: 'ready',
  },
  {
    name: 'LLM',
    responsibility: 'Project context and produce one complete model decision.',
    listens: 'llm.invoke',
    emits: 'llm.generated · tool.call',
    state: 'active',
  },
  {
    name: 'Tools',
    responsibility: 'Execute one model tool batch and record all outcomes.',
    listens: 'tool.call',
    emits: 'tool.result',
    state: 'ready',
  },
  {
    name: 'JSONL storage',
    responsibility: 'Persist every completed Journal fact.',
    listens: '*',
    emits: '—',
    state: 'ready',
  },
]

export const contextMessages = [
  { role: 'system', tokens: '612', text: 'You are Knot, a coding agent working inside the selected workspace…' },
  { role: 'user', tokens: '26', text: 'Run the tests, identify the failure, and make the smallest safe correction.' },
  { role: 'dynamic', tokens: '84', text: 'Workspace: /workspace/knot-agent · branch: main · goal: active · todo: 1 open' },
  { role: 'assistant', tokens: '41', text: 'I will inspect the failing test first.', tool: 'bash' },
  { role: 'tool', tokens: '139', text: 'exitCode: 1\nAssertionError: expected 3 events, received 4…' },
]

export const assemblyStages = [
  { label: 'Input', detail: 'Web input', tone: 'plain' },
  { label: 'Context', detail: 'WorkspaceContext', tone: 'violet' },
  { label: 'Flow', detail: 'CodingFlow + Guards', tone: 'blue' },
  { label: 'Content', detail: 'Mock / qwen3-coder', tone: 'violet' },
  { label: 'Effects', detail: 'Coding tools', tone: 'amber' },
  { label: 'Journal', detail: 'JSONL + Trace', tone: 'green' },
] as const
