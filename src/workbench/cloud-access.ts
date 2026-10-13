import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { WorkbenchAccessError } from './http-server.js'

export interface CloudIdentity { readonly subject: string; readonly token: string; readonly expiresAt: number }

/** No user-supplied key URLs, unverified userId, or bearer values in error messages. */
export function createCloudAccess(config: {
  apiKey: string; issuer: string; clientId: string; audience: string; jwksUrl: string
}, loadKeys = async (): Promise<readonly JsonWebKey[]> => {
  const response = await fetch(config.jwksUrl, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new WorkbenchAccessError(503, 'identity_service_unavailable')
  return (await response.json() as { keys: JsonWebKey[] }).keys
}) {
  if (config.apiKey.length < 32) throw new Error('Cloud ingress key must contain at least 32 characters')
  const expected = createHash('sha256').update(config.apiKey).digest()
  let keys: readonly JsonWebKey[] = []
  let loadedAt = 0
  let loading: Promise<void> | undefined
  return async (request: IncomingMessage, url: URL): Promise<CloudIdentity> => {
    const key = request.headers['x-api-key']
    if (typeof key !== 'string' || !timingSafeEqual(createHash('sha256').update(key).digest(), expected))
      throw new WorkbenchAccessError(401, 'unauthorized')
    const authorization = request.headers.authorization
    if (!authorization?.startsWith('Bearer ')) throw new WorkbenchAccessError(401, 'unauthorized')
    const token = authorization.slice(7)
    let header: { alg?: string; kid?: string }
    let claims: { iss?: string; sub?: string; azp?: string; aud?: string | string[]; exp?: number; nbf?: number }
    const parts = token.split('.')
    try {
      if (parts.length !== 3) throw new Error()
      header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString())
      claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
      if (!header || !claims) throw new Error()
    } catch { throw new WorkbenchAccessError(401, 'unauthorized') }
    const now = Math.floor(Date.now() / 1000)
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== config.issuer
      || claims.azp !== config.clientId || !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(config.audience)
      || typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || claims.exp <= now
      || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)))
      throw new WorkbenchAccessError(401, 'unauthorized')
    if (Date.now() - loadedAt > 3_600_000) {
      loading ??= loadKeys().then(value => { keys = value; loadedAt = Date.now() }).finally(() => { loading = undefined })
      try { await loading } catch { throw new WorkbenchAccessError(503, 'identity_service_unavailable') }
    }
    const jwk = keys.find(key => (key as JsonWebKey & { kid?: string }).kid === header.kid)
    try {
      if (!jwk || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2]!, 'base64url'))) throw new Error()
    } catch { throw new WorkbenchAccessError(401, 'unauthorized') }
    // Fail closed: hosted case1 is not a public developer Workbench.
    const collection = url.pathname === '/api/workbench/sessions'
    const session = /^\/api\/workbench\/sessions\/[a-zA-Z0-9-]+(?:\/(stream|messages|device-results|interactions))?$/.exec(url.pathname)
    const allowed = collection ? ['GET', 'POST'].includes(request.method ?? '') : session && url.pathname !== '/api/workbench/sessions/stream' && (
      request.method === 'GET' && (session[1] === undefined || session[1] === 'stream')
      || request.method === 'POST' && ['messages', 'device-results', 'interactions'].includes(session[1] ?? ''))
    if (!allowed) throw new WorkbenchAccessError(404, 'not_found')
    return { subject: claims.sub, token, expiresAt: claims.exp }
  }
}
