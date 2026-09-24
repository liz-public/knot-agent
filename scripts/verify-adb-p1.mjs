#!/usr/bin/env node
import { createAdbExecutor, probeAdbDevice } from '../dist/src/cases/case1/adb/executor.js'
import { createAdbDispatcher } from '../dist/src/cases/case1/adb/dispatcher.js'
import { createAdbDeviceSession } from '../dist/src/cases/case1/adb/session.js'
import { ANDROID_TOOL_CATALOG } from '../dist/src/cases/case1/android-tool-catalog.js'
import { createBashTool, createCliCatalog } from '../dist/src/cases/case1/cli.js'

const serial = process.env.ADB_SERIAL
const executor = createAdbExecutor({ serial })
const bash = createBashTool(
  createCliCatalog(ANDROID_TOOL_CATALOG),
  createAdbDispatcher(executor, createAdbDeviceSession()),
)

const checks = [
  'calendar.list 7',
  'notif.list --limit 5',
  'screen.read',
  'screenshot',
]

async function run(command) {
  const result = await bash.execute({ command }, { turnId: 'verify', callId: command })
  const payload = JSON.parse(result.content)
  const status = payload.ok ? 'OK' : 'FAIL'
  console.log(`${status}  ${command}`)
  if (!payload.ok) console.log('      ', payload.error, payload.hint)
  return payload.ok
}

const device = await probeAdbDevice(executor)
console.log(`Device: ${device.model} Android ${device.release}`)
console.log('---')

let passed = 0
for (const command of checks) {
  if (await run(command)) passed++
}
console.log('---')
console.log(`${passed}/${checks.length} passed`)
process.exitCode = passed === checks.length ? 0 : 1
