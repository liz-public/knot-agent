import type { Plugin } from '../../journal.js'
import { llmPlugin, type LlmCall, type LlmProvider } from './llm.js'
import type { LlmUsage } from './protocol.js'

export interface MockLlmOptions {
  readonly contextWindow?: number
  readonly firstAgentInputTokens?: number
}

export const mockLlmPlugin = (options: MockLlmOptions = {}): Plugin =>
  llmPlugin(mockLlmProvider(options))

export const mockLlmProvider = (options: MockLlmOptions = {}): LlmProvider => {
  const contextWindow = options.contextWindow ?? 1000
  let agentCalls = 0

  return {
    async generate(call: LlmCall) {
      if (call.request.purpose === 'history.compress') {
        return {
          generated: {
            content: '用户要求给李行素打电话；联系人查询得到唯一候选李行素。',
            toolCalls: [],
          },
          usage: usage(80, 24, contextWindow),
        }
      }

      agentCalls += 1
      let queryIndex = -1
      for (let index = call.messages.length - 1; index >= 0; index -= 1) {
        const message = call.messages[index]
        if (message?.role !== 'user') continue
        if (message.content?.startsWith('以下是仅对当前用户请求有效的运行时上下文：')) continue
        queryIndex = index
        break
      }
      const query = call.messages[queryIndex]?.content ?? ''
      const latestTool = [...call.messages.slice(queryIndex + 1)]
        .reverse()
        .find(message => message.role === 'tool')
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
      if (latestTool !== undefined) {
        const result = JSON.parse(latestTool.content ?? '{}') as Record<string, unknown>
        const successful = result['ok'] === true
        const hint = typeof result['hint'] === 'string' ? result['hint'] : ''
        let content: string
        if (!successful) {
          content = hint.length > 0 ? hint : `操作失败：${String(result['error'] ?? 'unknown_error')}。`
        } else if (typeof result['on'] === 'boolean') {
          content = result['on'] ? '已打开手电筒。' : '已关闭手电筒。'
        } else if (typeof result['percent'] === 'number' && typeof result['stream'] === 'string') {
          content = `已将${result['stream'] === 'ring' ? '铃声' : '媒体'}音量调到 ${result['percent']}%。`
        } else if (typeof result['brightness_percent'] === 'number') {
          content = `已将屏幕亮度调到 ${result['brightness_percent']}%。`
        } else if (typeof result['actual_mode'] === 'string') {
          content = `铃声模式已设置为 ${result['actual_mode']}。`
        } else if (typeof result['dnd_active'] === 'boolean') {
          content = result['dnd_active'] ? '已开启勿扰模式。' : '已关闭勿扰模式。'
        } else if (result['action'] === 'opened_wifi_panel') {
          content = '已打开 WiFi 系统面板，请在面板中完成设置。'
        } else if (typeof result['text'] === 'string') {
          content = `剪贴板内容是：${result['text']}`
        } else if (typeof result['char_count'] === 'number') {
          content = '已写入剪贴板。'
        } else {
          content = hint.length > 0 ? hint : '操作已完成。'
        }
        return {
          generated: { reasoning: '根据工具返回结果向用户确认。', content, toolCalls: [] },
          usage: usage(inputTokens, 20, contextWindow),
        }
      }

      const toolCall = mockToolCall(query, agentCalls)
      if (toolCall !== undefined) {
        return {
          generated: { reasoning: '需要调用设备工具完成用户请求。', toolCalls: [toolCall] },
          usage: usage(inputTokens, 24, contextWindow),
        }
      }
      return {
        generated: { content: '我暂时无法处理这个请求。', toolCalls: [] },
        usage: usage(inputTokens, 16, contextWindow),
      }
    },
  }
}

function mockToolCall(query: string, sequence: number) {
  const call = (name: string, arguments_: Record<string, unknown>) => ({
    id: `mock-${name}-${sequence}`,
    name,
    arguments: arguments_,
  })
  const percent = query.match(/([+-]?\d+)\s*%?/)?.[1]
  if (/音量/.test(query) && percent !== undefined) {
    return call('set_stream_volume', {
      percent,
      stream: /铃声/.test(query) ? 'ring' : 'music',
    })
  }
  if (/亮度/.test(query) && percent !== undefined) {
    return call('set_screen_brightness', { percent })
  }
  if (/读取?剪贴板|剪贴板.*(?:内容|有什么)/.test(query)) {
    return call('read_clipboard', {})
  }
  if (/剪贴板|复制/.test(query)) {
    const quoted = query.match(/[“「『"](.+?)[”」』"]/)?.[1]
    const text = quoted ?? query.replace(/^.*?(?:复制|写入)(?:到|进)?(?:剪贴板)?[：:，,\s]*/, '')
    return call('write_clipboard', { text })
  }
  if (/Wi-?Fi|无线网络/i.test(query)) {
    return call('set_wifi_enabled', { enabled: !/关|断/.test(query) })
  }
  if (/勿扰|免打扰/.test(query)) {
    return call('set_do_not_disturb', { enabled: !/关|取消/.test(query) })
  }
  if (/静音|振动|震动|响铃/.test(query)) {
    const mode = /静音/.test(query) ? 'silent' : /振动|震动/.test(query) ? 'vibrate' : 'normal'
    return call('set_ringer_mode', { mode })
  }
  return undefined
}

function usage(inputTokens: number, outputTokens: number, contextWindow: number): LlmUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    contextWindow,
  }
}
