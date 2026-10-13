import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { createCloudAccess } from '../src/workbench/cloud-access.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import { createSessionRegistry } from '../src/workbench/session-registry.js'
import type { WorkbenchSession } from '../src/workbench/session.js'

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const config = { apiKey: 'fixture-ingress-key-with-32-characters', issuer: 'https://identity.example/realm', clientId: 'client', audience: 'gateway', jwksUrl: 'https://identity.example/keys' }
const keys = [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture' }]
function token(subject = 'alice', patch: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: subject, iss: config.issuer, azp: config.clientId,
    aud: [config.audience], exp: Math.floor(Date.now() / 1000) + 300, ...patch })).toString('base64url')
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), pair.privateKey).toString('base64url')}`
}
function request(authorization = `Bearer ${token()}`, key = config.apiKey, method = 'GET') {
  return { method, headers: { authorization, 'x-api-key': key } } as unknown as IncomingMessage
}
test('cloud identity verifies signature, issuer, client, audience and expiration', async () => {
  const access = createCloudAccess(config, async () => keys)
  const url = new URL('http://local/api/workbench/sessions')
  assert.equal((await access(request(), url)).subject, 'alice')
  for (const patch of [{ iss: 'https://wrong' }, { azp: 'wrong' }, { aud: 'wrong' }, { exp: 0 }])
    await assert.rejects(access(request(`Bearer ${token('alice', patch)}`), url), /unauthorized/)
  await assert.rejects(access(request(undefined, 'wrong'), url), /unauthorized/)
  await assert.rejects(access(request('Bearer invalid'), url), /unauthorized/)
  const forged = token().split('.')
  forged[1] = Buffer.from(JSON.stringify({ sub: 'bob', iss: config.issuer })).toString('base64url')
  await assert.rejects(access(request(`Bearer ${forged.join('.')}`), url), /unauthorized/)
})
test('cloud routes do not expose developer, terminal, files or configuration APIs', async () => {
  const access = createCloudAccess(config, async () => keys)
  for (const path of ['/api/workbench/providers', '/api/workbench/studio', '/api/workbench/sessions/id/files/read',
    '/api/workbench/sessions/id/configuration', '/api/session/uploadFileBinary', '/api/workbench/sessions/stream'])
    await assert.rejects(access(request(), new URL(`http://local${path}`)), /not_found/)
})
test('all existing HTTP routes use the authenticated tenant registry', async () => {
  const access = createCloudAccess(config, async () => keys)
  const alice = { id: 'alice-session', summary: async () => ({ id: 'alice-session' }),
    snapshot: async () => ({ session: { id: 'alice-session' }, events: [] }) } as unknown as WorkbenchSession
  const registries = new Map([['alice', createSessionRegistry([alice])], ['bob', createSessionRegistry()]])
  const server = createWorkbenchServer({ sessions: [alice], async requestScope(req, url) {
    const identity = await access(req, url)
    return { sessionRegistry: registries.get(identity.subject)!, createSession: async () => alice }
  } })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const root = `http://127.0.0.1:${address.port}/api/workbench/sessions`
  const headers = (user: string) => ({ 'x-api-key': config.apiKey, authorization: `Bearer ${token(user)}` })
  try {
    assert.equal((await fetch(root)).status, 401)
    assert.equal((await fetch(`${root}/alice-session`, { headers: headers('bob') })).status, 404)
    assert.deepEqual((await (await fetch(root, { headers: headers('bob') })).json()), { sessions: [] })
    assert.equal((await fetch(`${root}/alice-session`, { headers: headers('alice') })).status, 200)
    for (const suffix of ['stream', 'messages', 'device-results', 'interactions']) {
      const response = await fetch(`${root}/alice-session/${suffix}`, { headers: { ...headers('bob'), 'content-type': 'application/json' },
        method: suffix === 'stream' ? 'GET' : 'POST', ...(suffix === 'stream' ? {} : { body: '{"content":"x","operationId":"x","result":{"ok":true}}' }) })
      assert.ok([404, 405].includes(response.status), `${suffix}: ${response.status}`)
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
