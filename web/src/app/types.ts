import type { JournalSnapshot } from '../api/workbench-api'

export type Mode = 'run' | 'studio'
export type DialogKind = 'new-session' | 'new-case' | 'projects' | 'settings' | 'plugin-library'
export type JournalState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: JournalSnapshot }
  | { readonly status: 'error'; readonly message: string }

export interface LiveToolCallDraft { readonly name?: string; readonly argumentsPreview: string; readonly argumentChars: number }
export interface LiveDraft { readonly requestId: string; readonly reasoning: string; readonly content: string; readonly toolCalls: readonly LiveToolCallDraft[] }
export interface LiveToolDraft { readonly callId: string; readonly toolName: string; readonly command: string; readonly output: string; readonly exitCode?: number }
export interface ProjectFixture { readonly id: string; readonly name: string; readonly summary: string; readonly root: string }

export const liveArgumentPreviewLimit = 4_096
export const initialProjects: readonly ProjectFixture[] = [
  { id: 'local', name: 'Knot', summary: 'Local workbench', root: '.' },
]
