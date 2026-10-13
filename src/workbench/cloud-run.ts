import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createCloudAccess, type CloudIdentity } from './cloud-access.js'
import { createWorkbenchServer, WorkbenchAccessError } from './http-server.js'
import { createSessionRegistry } from './session-registry.js'
import { createCase1Assembly } from './case1-assembly.js'
import { createDeviceCase1ToolRuntime } from '../cases/case1/device-runtime.js'
import { createLiveSession } from './live-session.js'
import { loadSessionDescriptors, saveSessionDescriptor, sessionWithMetadata, type LiveSessionDescriptor } from './session-catalog.js'
import { providerProfilesFromEnvironment } from './provider-profile.js'
import type { WorkbenchSession } from './session.js'
import type { LlmProvider } from '../agent/plugins/llm.js'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
const issuer = required('KNOT_CLOUD_ISSUER')
const authorize = createCloudAccess({ apiKey: required('KNOT_CLOUD_API_KEY'), issuer,
  clientId: required('KNOT_CLOUD_CLIENT_ID'), audience: required('KNOT_CLOUD_AUDIENCE'),
  jwksUrl: `${issuer}/protocol/openid-connect/certs` })
const root = resolve(required('KNOT_CLOUD_DATA_DIR'))
process.umask(0o077)
const assembly = createCase1Assembly((ask, input) => createDeviceCase1ToolRuntime(input.devicePort!, undefined, ask))
const environments = { ...process.env }
// Credentials are selected for each real generation, never stored in Journal or mutated globally.
async function tenant(identity: CloudIdentity) {
  const directory = join(root, createHash('sha256').update(identity.subject).digest('hex'))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const registry = createSessionRegistry()
  const credential = { value: identity }
  const llm: LlmProvider = { async generate(input, output) {
    const current = credential.value
    if (current.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('user_authorization_expired')
    const profile = providerProfilesFromEnvironment({ ...environments, KNOT_API_KEY: current.token })[0]!
    try { return await profile.create().generate(input, output) }
    catch { throw new Error('llm_request_failed') }
  } }
  const profile = providerProfilesFromEnvironment({ ...environments, KNOT_API_KEY: identity.token })[0]
  if (!profile?.configured) throw new Error('A configured default LLM provider is required')
  async function live(descriptor: LiveSessionDescriptor, title?: string): Promise<WorkbenchSession> {
    if (descriptor.assembly !== 'case1') throw new Error('Unexpected hosted assembly')
    return sessionWithMetadata(directory, descriptor, await createLiveSession({ ...descriptor, assembly, llm,
      ...(title === undefined ? {} : { title }), defaultConfiguration: {
        inference: { providerProfileId: 'default', provider: profile!.adapter, model: profile!.model }, approvalMode: 'ask',
      } }))
  }
  for (const descriptor of await loadSessionDescriptors(directory)) registry.add(await live(descriptor))
  return { registry, credential, async createSession(input: { title?: string; assemblyId?: string }) {
    if (input.assemblyId !== undefined && input.assemblyId !== 'case1') throw new WorkbenchAccessError(400, 'case1_only')
    const id = `case1-${randomUUID()}`
    const descriptor = { id, cwd: directory, journalPath: join(directory, `${id}.jsonl`), assembly: 'case1' }
    const session = await live(descriptor, input.title?.slice(0, 200))
    await saveSessionDescriptor(directory, descriptor)
    return session
  } }
}
const tenants = new Map<string, ReturnType<typeof tenant>>()
const server = createWorkbenchServer({ sessions: [], async requestScope(request, url) {
  const identity = await authorize(request, url)
  let pending = tenants.get(identity.subject)
  if (!pending) {
    pending = tenant(identity)
    tenants.set(identity.subject, pending)
    void pending.catch(() => { tenants.delete(identity.subject) })
  }
  const current = await pending
  if (identity.expiresAt >= current.credential.value.expiresAt) current.credential.value = identity
  return { sessionRegistry: current.registry, createSession: current.createSession, expiresAt: identity.expiresAt }
} })
const port = Number(process.env['KNOT_CLOUD_PORT'] ?? 4320)
server.listen(port, '127.0.0.1', () => console.info(`case1 ingress listening on loopback:${port}`))
