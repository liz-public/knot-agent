import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ANDROID_TOOL_CATALOG } from '../src/cases/case1/android-tool-catalog.js'
import { createCliCatalog } from '../src/cases/case1/cli.js'

const catalog = createCliCatalog(ANDROID_TOOL_CATALOG)

function resolve(command: string) {
  const result = catalog.resolve(command)
  if ('content' in result) throw new Error(result.content)
  return result
}

test('catalog command names and toolIds are unique', () => {
  const names = ANDROID_TOOL_CATALOG.map(item => item.name)
  const toolIds = ANDROID_TOOL_CATALOG.map(item => item.toolId)
  assert.equal(new Set(names).size, names.length)
  assert.equal(new Set(toolIds).size, toolIds.length)
})

test('the review snapshot matches the runtime catalog exactly', () => {
  const snapshot = JSON.parse(readFileSync('docs/case1/android-tool-catalog.metadata.json', 'utf8')) as {
    tools: Array<Record<string, unknown> & { batch: number }>
  }
  const reviewed = snapshot.tools.map(({ batch: _batch, ...tool }) => tool)
  const runtime = ANDROID_TOOL_CATALOG.map(command => ({
    toolId: command.toolId,
    cliName: command.name,
    summary: command.summary,
    description: command.description,
    usage: catalog.usage(command),
    arguments: command.arguments,
    examples: command.examples,
    keywords: command.keywords,
  }))
  assert.deepEqual(reviewed, runtime)
})

test('catalog covers all P0 and P1 CLI commands', () => {
  const expected = [
    'contact', 'contact.add', 'contact.delete', 'dial', 'select', 'call.log', 'hangup', 'wechat.send',
    'sms.list', 'sms.send', 'device.status', 'sys.volume', 'sys.ringer', 'sys.dnd', 'sys.wifi',
    'sys.brightness', 'sys.rotation', 'media.toggle', 'date', 'alarm.set', 'alarm.list', 'ask',
    'app.open', 'uri.open', 'qrcode.scan', 'qrcode.pay', 'qrcode.ride',
    'location', 'weather', 'calendar.list', 'calendar.set', 'calendar.delete', 'notif.list',
    'map.navi', 'map.route', 'map.nearby', 'app.list', 'appstore.search', 'timer',
    'hotspot', 'ringtone', 'ime', 'sys.settings.open', 'express', 'food.explore',
    'shopping.search', 'meeting.join', 'flight.query', 'hotel.query', 'train.query',
    'ticket.query', 'content.search', 'screenshot', 'screen.read',
  ]
  const names = new Set(ANDROID_TOOL_CATALOG.map(item => item.name))
  for (const name of expected) assert.ok(names.has(name), `missing catalog command: ${name}`)
  assert.equal(expected.length, 54)
  assert.equal(ANDROID_TOOL_CATALOG.length, 57)
})

test('the shared binder maps representative commands without business coercion', () => {
  assert.deepEqual(resolve('call.log missed --time_scope last_7d --limit 10').arguments, {
    type: 'missed',
    time_scope: 'last_7d',
    limit: '10',
  })
  assert.deepEqual(resolve('app.list 微信 --limit 20').arguments, { query: '微信', limit: '20' })
  assert.deepEqual(resolve('sms.send 18811026772 "今晚 回家吃饭"').arguments, {
    phone: '18811026772',
    text: '今晚 回家吃饭',
  })
  assert.deepEqual(resolve('calendar.delete 610').arguments, { event_id: '610' })
  assert.deepEqual(resolve('content.search 北京美食 --provider xhs').arguments, {
    keyword: '北京美食',
    provider: 'xhs',
  })
  assert.deepEqual(resolve('meeting.join wemeet 927318171 --password 123456').arguments, {
    provider: 'wemeet',
    meeting_code: '927318171',
    password: '123456',
  })
  assert.deepEqual(resolve('flight.query 上海 --when 06-15 --round --return 06-22').arguments, {
    arrive: '上海',
    when: '06-15',
    round: true,
    return_date: '06-22',
  })
})

test('usage is generated from argument metadata and every example resolves', () => {
  assert.equal(catalog.usage(ANDROID_TOOL_CATALOG.find(command => command.name === 'sys.volume')!),
    'sys.volume <[+|-]percent> [--stream <music|ring|alarm|notification>]')
  for (const command of ANDROID_TOOL_CATALOG) {
    for (const example of command.examples) resolve(example)
  }
})

test('content search intent is matched by provider aliases instead of generic search wording', () => {
  const catalog = createCliCatalog(ANDROID_TOOL_CATALOG)
  assert.deepEqual(catalog.detailsFor('用抖音搜索周杰伦').names, ['content.search'])
  assert.deepEqual(catalog.detailsFor('用网易云音乐搜索周杰伦').names, ['content.search'])
  assert.deepEqual(
    catalog.detailsFor('下载知乎').names,
    ['appstore.search', 'content.search'],
  )
  assert.deepEqual(catalog.detailsFor('搜索未知内容').names, [])
})

test('the binder rejects protocol-shape errors before dispatch', () => {
  for (const input of [
    'sys.volume',
    'sys.volume 20 --strem music',
    'sys.volume 20 --stream',
    'sys.volume 20 --stream voice',
    'flight.query --round 上海',
  ]) {
    const result = catalog.resolve(input)
    assert.ok('content' in result, `expected bad arguments: ${input}`)
    assert.equal(JSON.parse(result.content).error, 'bad_arguments')
  }
})
