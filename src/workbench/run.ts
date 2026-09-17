import { createWorkbenchServer, type StoredSessionConfig } from './http-server.js'

function configuredSessions(): readonly StoredSessionConfig[] {
  const value = process.env['KNOT_WORKBENCH_SESSIONS']
  if (value !== undefined) {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) throw new Error('KNOT_WORKBENCH_SESSIONS must be a JSON array')
    return parsed as StoredSessionConfig[]
  }
  const journalPath = process.env['KNOT_JOURNAL_PATH']
  if (journalPath === undefined || journalPath.length === 0) {
    throw new Error('KNOT_JOURNAL_PATH or KNOT_WORKBENCH_SESSIONS is required')
  }
  return [{
    id: 'case2-main',
    title: 'CASE2 coding session',
    assembly: 'case2',
    journalPath,
  }]
}

const port = Number(process.env['KNOT_WORKBENCH_PORT'] ?? '4317')
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error('KNOT_WORKBENCH_PORT must be an integer between 0 and 65535')
}

const sessions = configuredSessions()
const server = createWorkbenchServer({ sessions })
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Knot workbench read host: http://127.0.0.1:${port}\n`)
  process.stdout.write(`Sessions: ${sessions.map(session => session.id).join(', ')}\n`)
})
