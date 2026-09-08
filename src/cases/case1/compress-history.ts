import type { Event, Plugin } from '../../journal.js'
import {
  HISTORY_CHECKPOINT,
  HISTORY_COMPACTION_REQUIRED,
  HISTORY_COMPRESS_REQUEST,
  LLM_GENERATED,
  LLM_REQUEST,
  type HistoryCheckpoint,
  type HistoryCompactionRequired,
  type HistoryCompressRequest,
  type LlmGenerated,
} from './protocol.js'

export interface CompressHistoryOptions {
  readonly threshold?: number
  readonly instruction?: string
}

const defaultInstruction = [
  '请将会话历史压缩为简洁、准确、可继续执行任务的摘要。',
  '保留用户目标、关键事实、已经执行的动作、工具结果、未完成事项和约束。',
  '不要加入原文中不存在的信息。只输出摘要正文。',
].join('\n')

function hasPendingCompaction(events: readonly Event[]): boolean {
  const completed = new Set(events
    .filter(event => event.type === HISTORY_CHECKPOINT)
    .map(event => (event.data as HistoryCheckpoint).requirementId))
  return events
    .filter(event => event.type === HISTORY_COMPACTION_REQUIRED)
    .some(event => !completed.has((event.data as HistoryCompactionRequired).requirementId))
}

export const compressHistoryPlugin = (options: CompressHistoryOptions = {}): Plugin => journal => {
  const threshold = options.threshold ?? 0.8
  const instruction = options.instruction ?? defaultInstruction

  journal.subscribe(LLM_GENERATED, event => {
    const result = event.data as LlmGenerated

    if (result.request.purpose === 'history.compress') {
      const summary = result.generated.content
      if (summary === undefined || summary.length === 0) {
        throw new Error('history compression returned no summary')
      }
      journal.append(HISTORY_CHECKPOINT, {
        requirementId: result.request.requirementId,
        throughRequestId: result.request.throughRequestId,
        summary,
      })
      journal.append(LLM_REQUEST, result.request.resume)
      return
    }

    const { totalTokens, contextWindow } = result.usage
    if (contextWindow <= 0 || totalTokens / contextWindow < threshold) return
    if (hasPendingCompaction(journal.read())) return
    journal.append(HISTORY_COMPACTION_REQUIRED, {
      requirementId: `compact-${result.requestId}`,
      throughRequestId: result.requestId,
    })
  })

  journal.subscribe(HISTORY_COMPRESS_REQUEST, event => {
    const request = event.data as HistoryCompressRequest
    journal.append(LLM_REQUEST, {
      purpose: 'history.compress',
      turnId: request.turnId,
      requirementId: request.requirementId,
      throughRequestId: request.throughRequestId,
      instruction,
      resume: request.resume,
    })
  })
}
