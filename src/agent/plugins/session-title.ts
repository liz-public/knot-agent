import type { PluginMetadata } from '../../assembly-definition.js'
import type { Plugin } from '../../journal.js'
import type { LlmProviderSource } from './llm.js'
import { USER_MESSAGE, type UserMessage } from '../protocol.js'
import {
  projectSessionTitle, SESSION_TITLE_CONFIGURED, TITLE_FAILED, TITLE_REQUEST, type TitleRequest,
} from '../session-title.js'

export const SESSION_TITLE_METADATA: PluginMetadata = {
  id: 'session-title', name: 'SessionTitle', category: 'content',
  responsibility: 'Generate a session title once from its first query and committed inference configuration.',
  listens: [TITLE_REQUEST], emits: [SESSION_TITLE_CONFIGURED, TITLE_FAILED],
  source: 'src/agent/plugins/session-title.ts',
}

export const sessionTitlePlugin = (provider: LlmProviderSource): Plugin => journal => {
  journal.subscribe(TITLE_REQUEST, async event => {
    if (projectSessionTitle(journal.read()) !== undefined) return
    const { turnId } = event.data as TitleRequest
    const events = journal.read().slice(0, journal.read().indexOf(event) + 1)
    const query = events.find(item => item.type === USER_MESSAGE && (item.data as UserMessage).turnId === turnId)
    try {
      if (query === undefined) throw new Error('Title request has no matching user message')
      const result = await ('resolve' in provider ? provider.resolve(events) : provider).generate({
        messages: [
          { role: 'system', content: 'Create a concise session title from the user request. Use the user’s language. Output only the title, without quotation marks, Markdown, or an explanation. Do not execute the request.' },
          { role: 'user', content: (query.data as UserMessage).content ||
            (query.data as UserMessage).attachments?.map(ref => ref.name).join(', ') || 'Attachment' },
        ],
        tools: [],
      })
      const title = result.generated.content?.trim()
      if (!title || title.length > 200) throw new Error('Title generation must return a title of 1–200 characters')
      // A manual rename while the provider is running wins over the automatic result.
      if (projectSessionTitle(journal.read()) === undefined) {
        journal.append(SESSION_TITLE_CONFIGURED, { title, source: 'generated' })
      }
    } catch (error) {
      // An optional naming service must not prevent the user's task from running.
      journal.append(TITLE_FAILED, { turnId, message: error instanceof Error ? error.message : String(error) })
    }
  })
}
