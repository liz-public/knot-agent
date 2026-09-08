import type { Plugin } from '../../journal.js'
import { llmPlugin, type LlmProvider } from './llm.js'
import type { LlmInvoke, LlmUsage } from './protocol.js'

export interface MockLlmOptions {
  readonly contextWindow?: number
  readonly firstAgentInputTokens?: number
}

export const mockLlmPlugin = (options: MockLlmOptions = {}): Plugin => {
  const contextWindow = options.contextWindow ?? 1000
  let agentCalls = 0

  const provider: LlmProvider = {
    async generate(invoke: LlmInvoke) {
      if (invoke.request.purpose === 'history.compress') {
        return {
          generated: {
            content: '用户要求给李行素打电话；联系人查询得到唯一候选李行素。',
            toolCalls: [],
          },
          usage: usage(80, 24, contextWindow),
        }
      }

      agentCalls += 1
      const latestTool = [...invoke.messages].reverse().find(message => message.role === 'tool')
      const inputTokens = agentCalls === 1 && options.firstAgentInputTokens !== undefined
        ? options.firstAgentInputTokens
        : 120

      if (latestTool?.content?.includes('"action":"candidates"')) {
        return {
          generated: {
            reasoning: '联系人只有一个候选，按工具提示选择第 1 项。',
            toolCalls: [{
              id: 'mock-select-1',
              name: 'bash',
              arguments: { command: 'select 1' },
            }],
          },
          usage: usage(inputTokens, 32, contextWindow),
        }
      }
      if (latestTool?.content?.includes('"action":"direct_dial"')) {
        return {
          generated: {
            reasoning: '工具已经确认拨号成功，应直接告知用户结果。',
            content: '已为您拨通李行素的电话。',
            toolCalls: [],
          },
          usage: usage(inputTokens, 20, contextWindow),
        }
      }
      return {
        generated: { content: '我暂时无法处理这个请求。', toolCalls: [] },
        usage: usage(inputTokens, 16, contextWindow),
      }
    },
  }

  return llmPlugin(provider)
}

function usage(inputTokens: number, outputTokens: number, contextWindow: number): LlmUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    contextWindow,
  }
}
