export interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

export interface WebSearchResult {
  readonly sources: readonly WebSearchSource[]
}

export interface WebSearchProvider {
  search(query: string): Promise<WebSearchResult>
}

export interface DeepSeekSearchOptions {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly model?: string
  readonly maxUses?: number
}

type ContentBlock = {
  type?: string
  content?: Array<{ type?: string; url?: string; title?: string; page_age?: string }>
  citations?: Array<{ url?: string; cited_text?: string }>
}

export function deepSeekSearchProvider(options: DeepSeekSearchOptions): WebSearchProvider {
  const endpoint = `${(options.baseUrl ?? 'https://api.deepseek.com/anthropic/v1').replace(/\/$/, '')}/messages`
  return {
    async search(query) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': options.apiKey,
          authorization: `Bearer ${options.apiKey}`,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model ?? 'deepseek-v4-flash',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: `Perform a web search for the query: ${query}` }],
          }],
          tools: [{
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: options.maxUses ?? 5,
          }],
        }),
      })
      if (!response.ok) throw new Error(`DeepSeek search HTTP ${response.status}: ${await response.text()}`)
      const body = await response.json() as { content?: ContentBlock[] }
      const blocks = body.content ?? []
      const snippets = new Map<string, string>()
      for (const block of blocks) {
        for (const citation of block.citations ?? []) {
          if (citation.url !== undefined && citation.cited_text !== undefined && !snippets.has(citation.url)) {
            snippets.set(citation.url, citation.cited_text)
          }
        }
      }
      const seen = new Set<string>()
      const sources: WebSearchSource[] = []
      for (const block of blocks) {
        if (block.type !== 'web_search_tool_result') continue
        for (const item of block.content ?? []) {
          if (item.type !== 'web_search_result' || item.url === undefined || seen.has(item.url)) continue
          seen.add(item.url)
          sources.push({
            url: item.url,
            ...(item.title === undefined ? {} : { title: item.title }),
            ...(snippets.get(item.url) === undefined ? {} : { snippet: snippets.get(item.url) }),
            ...(item.page_age === undefined ? {} : { publishedAt: item.page_age }),
          })
        }
      }
      if (!blocks.some(block => block.type === 'web_search_tool_result')) {
        throw new Error('DeepSeek returned no web_search_tool_result')
      }
      return { sources }
    },
  }
}
