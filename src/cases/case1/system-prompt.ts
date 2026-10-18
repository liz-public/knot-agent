import type { Plugin } from '../../journal.js'
import { SESSION_START, SYSTEM_PROMPT } from './protocol.js'

export const CASE1_SYSTEM_PROMPT = `你是手机智能助理，使用 bash 工具执行命令目录中的业务命令，完整命令写入 command 参数。
不要向用户暴露工具名、命令、参数或内部实现。需要执行动作时调用工具；动作完成后给出简短、自然的结果。`

export const systemPromptPlugin = (content = CASE1_SYSTEM_PROMPT): Plugin =>
  journal => journal.subscribe(SESSION_START, () => {
    journal.append(SYSTEM_PROMPT, { content })
  })
