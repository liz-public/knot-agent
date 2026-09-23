import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  providerProfilesFromEnvironment,
  publicProviderProfile,
} from '../src/workbench/provider-profile.js'
import { createProviderProfileStore } from '../src/workbench/provider-profile-store.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'

test('provider profiles keep credentials server-side and expose configuration state', () => {
  const profiles = providerProfilesFromEnvironment({
    KNOT_BASE_URL: 'https://maas.invalid/v1',
    KNOT_MODEL: 'qwen3-coder',
    KNOT_API_KEY: 'maas-secret',
  })

  assert.deepEqual(profiles.map(publicProviderProfile), [
    {
      id: 'default',
      label: 'qwen3-coder',
      adapter: 'openai-compatible',
      model: 'qwen3-coder',
      configured: true,
    },
    {
      id: 'deepseek',
      label: 'DeepSeek · deepseek-flash',
      adapter: 'deepseek',
      model: 'deepseek-flash',
      reasoningEfforts: ['none', 'low', 'high', 'max'],
      defaultReasoningEffort: 'high',
      configured: false,
    },
  ])
  assert.doesNotMatch(JSON.stringify(profiles.map(publicProviderProfile)), /secret/)
})

test('DeepSeek becomes a selectable profile only when its server credential exists', () => {
  const profiles = providerProfilesFromEnvironment({
    DEEPSEEK_API_KEY: 'deepseek-secret',
    KNOT_DEEPSEEK_MODEL: 'deepseek-v4-pro',
    KNOT_DEEPSEEK_THINKING: 'enabled',
    KNOT_DEEPSEEK_REASONING_EFFORT: 'high',
  })
  const deepSeek = profiles.find(profile => profile.id === 'deepseek')

  assert.equal(deepSeek?.configured, true)
  assert.equal(deepSeek?.model, 'deepseek-v4-pro')
  assert.deepEqual(deepSeek?.reasoningEfforts, ['none', 'low', 'high', 'max'])
  assert.equal(deepSeek?.defaultReasoningEffort, 'high')
  assert.ok(deepSeek?.create({ reasoningEffort: 'low' }))
})

test('local provider profiles persist privately and never expose credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-providers-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'providers.json')
  const store = await createProviderProfileStore(path, [])
  const summary = await store.add({
    label: 'Local DeepSeek',
    adapter: 'deepseek',
    model: 'deepseek-chat',
    apiKey: 'private-key',
    defaultReasoningEffort: 'low',
  })

  assert.equal(summary.configured, true)
  assert.equal(summary.editable, true)
  assert.doesNotMatch(JSON.stringify(summary), /private-key/)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.match(await readFile(path, 'utf8'), /private-key/)

  const restored = await createProviderProfileStore(path, [])
  assert.equal(restored.get(summary.id)?.model, 'deepseek-chat')
  assert.doesNotMatch(JSON.stringify(restored.list().map(publicProviderProfile)), /private-key/)

  await restored.update(summary.id, {
    label: 'Updated DeepSeek',
    adapter: 'deepseek',
    model: 'deepseek-reasoner',
    defaultReasoningEffort: 'high',
  })
  assert.equal(restored.get(summary.id)?.model, 'deepseek-reasoner')
  assert.match(await readFile(path, 'utf8'), /private-key/)
  await restored.setDefault(summary.id)
  assert.equal(restored.default()?.id, summary.id)
  assert.equal(restored.list().find(profile => profile.id === summary.id)?.isDefault, true)

  const reloaded = await createProviderProfileStore(path, [])
  assert.equal(reloaded.default()?.id, summary.id)
  await reloaded.remove(summary.id)
  assert.equal(reloaded.get(summary.id), undefined)
})

test('workbench creates a redacted local Provider profile over HTTP', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-provider-http-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await createProviderProfileStore(join(directory, 'providers.json'), [])
  let testedId: string | undefined
  const server = createWorkbenchServer({
    sessions: [],
    providerProfiles: () => store.list().map(publicProviderProfile),
    createProviderProfile: input => store.add(input),
    updateProviderProfile: (id, input) => store.update(id, input),
    deleteProviderProfile: id => store.remove(id),
    setDefaultProviderProfile: id => store.setDefault(id),
    testProviderProfile: async id => { testedId = id },
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP server')

  const response = await fetch(`http://127.0.0.1:${address.port}/api/workbench/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Configured in Web',
      adapter: 'openai-compatible',
      baseUrl: 'https://provider.invalid/v1',
      model: 'coder',
      apiKey: 'http-secret',
    }),
  })
  assert.equal(response.status, 201)
  const createdText = await response.text()
  assert.doesNotMatch(createdText, /http-secret/)
  const created = JSON.parse(createdText) as { provider: { id: string } }

  const updated = await fetch(`http://127.0.0.1:${address.port}/api/workbench/providers/${created.provider.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Edited in Web', adapter: 'openai-compatible', baseUrl: 'https://edited.invalid/v1', model: 'coder-v2',
    }),
  })
  assert.equal(updated.status, 200)
  assert.doesNotMatch(await updated.text(), /http-secret/)

  const setDefault = await fetch(`http://127.0.0.1:${address.port}/api/workbench/providers/${created.provider.id}/default`, { method: 'POST' })
  assert.equal(setDefault.status, 200)
  const tested = await fetch(`http://127.0.0.1:${address.port}/api/workbench/providers/${created.provider.id}/test`, { method: 'POST' })
  assert.equal(tested.status, 200)
  assert.equal(testedId, created.provider.id)

  const listed = await fetch(`http://127.0.0.1:${address.port}/api/workbench/providers`)
  assert.equal(listed.status, 200)
  const text = await listed.text()
  assert.match(text, /Edited in Web/)
  assert.doesNotMatch(text, /http-secret/)

  const deleted = await fetch(`http://127.0.0.1:${address.port}/api/workbench/providers/${created.provider.id}`, { method: 'DELETE' })
  assert.equal(deleted.status, 200)
  assert.equal(store.get(created.provider.id), undefined)
})
