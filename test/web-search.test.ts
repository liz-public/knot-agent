import assert from 'node:assert/strict'
import test from 'node:test'
import { deepSeekSearchProvider } from '../src/agent/providers/deepseek-search.js'
import { webSearchTool } from '../src/agent/tools/web-search.js'
import { toolsPlugin } from '../src/agent/plugins/tools.js'
import { createJournal } from '../src/journal.js'
import { TOOL_REGISTRY, USER_MESSAGE } from '../src/agent/protocol.js'

test('DeepSeek search adapter maps native result blocks and citation snippets', async () => {
  const originalFetch = globalThis.fetch
  let request: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      content: [
        {
          type: 'web_search_tool_result',
          content: [{ type: 'web_search_result', url: 'https://example.com/news', title: 'Example', page_age: '2026-09-29' }],
        },
        { type: 'text', citations: [{ url: 'https://example.com/news', cited_text: 'A current result.' }] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await deepSeekSearchProvider({ apiKey: 'secret' }).search('current example')
    assert.equal(request?.['model'], 'deepseek-v4-flash')
    assert.deepEqual(result.sources, [{
      url: 'https://example.com/news',
      title: 'Example',
      snippet: 'A current result.',
      publishedAt: '2026-09-29',
    }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web search tool keeps provider selection outside the model-facing contract', async () => {
  const tool = webSearchTool({
    async search(query) {
      assert.equal(query, 'Knot agent')
      return { sources: [{ url: 'https://example.com/knot', title: 'Knot' }] }
    },
  })
  const result = JSON.parse((await tool.execute({ query: 'Knot agent' }, {
    turnId: 'turn-1',
    callId: 'search-1',
  })).content) as Record<string, unknown>
  assert.equal(result['ok'], true)
  assert.match(String(result['notice']), /untrusted/)
})

test('tools plugin refreshes a restored registry only when the assembled tools changed', async () => {
  const { journal, runUntilIdle } = createJournal()
  journal.append(TOOL_REGISTRY, { schemas: [] })
  await runUntilIdle()
  toolsPlugin([webSearchTool({ search: async () => ({ sources: [] }) })])(journal)

  journal.append(USER_MESSAGE, { turnId: 'turn-1', content: 'Search.' })
  await runUntilIdle()
  journal.append(USER_MESSAGE, { turnId: 'turn-2', content: 'Search again.' })
  await runUntilIdle()

  const registries = journal.read().filter(event => event.type === TOOL_REGISTRY)
  assert.equal(registries.length, 2)
  assert.equal(((registries[1]?.data as { schemas: unknown[] }).schemas).length, 1)
})
