import assert from 'node:assert/strict'
import test from 'node:test'
import {
  providerProfilesFromEnvironment,
  publicProviderProfile,
} from '../src/workbench/provider-profile.js'

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
  assert.ok(deepSeek?.create())
})
