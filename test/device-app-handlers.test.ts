import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceAppHandlers } from '../src/cases/case1/device-app-handlers.js'
import { ANDROID_TOOL_CATALOG } from '../src/cases/case1/android-tool-catalog.js'

const context = { turnId: 'turn', callId: 'call' }
test('payment omission uses installed order, but an explicit provider never falls back', async () => {
  for (const installed of [['com.tencent.mm', 'com.eg.android.AlipayGphone'], ['com.eg.android.AlipayGphone'], ['com.unionpay']]) {
    const calls: any[] = []
    const handlers = deviceAppHandlers({ async request(capability, args) {
      calls.push({ capability, args })
      return capability === 'packages.installed'
        ? { ok: true, installed: installed.includes(String(args.packageName)) } : { ok: true }
    } })
    const expected = installed[0] === 'com.tencent.mm' ? 'wechat' : installed[0] === 'com.eg.android.AlipayGphone' ? 'alipay' : 'unionpay'
    assert.equal(JSON.parse((await handlers['pay']!({}, context)).content).provider, expected)
    calls.length = 0
    const explicit = JSON.parse((await handlers['pay']!({ provider: 'wechat' }, context)).content)
    assert.equal(explicit.ok, installed.includes('com.tencent.mm'))
    if (!explicit.ok) {
      assert.equal(explicit.error, 'app_not_installed')
      assert.equal(calls.length, 1)
      assert.equal(calls[0].capability, 'packages.installed')
    }
  }
})
test('Taobao uses its exported browser entry; JD and PDD keep ordinary VIEW', async () => {
  const calls: any[] = []
  const handlers = deviceAppHandlers({ async request(capability, args) { calls.push({ capability, args }); return { ok: true, installed: true } } })
  for (const provider of ['taobao', 'jd', 'pdd']) {
    const result = await handlers['search_shopping']!({ provider, keyword: 'fixture' }, context)
    assert.equal(JSON.parse(result.content).ok, true)
    const last = calls.at(-1)
    assert.equal(last.capability, provider === 'taobao' ? 'intent.launch' : 'intent.view')
    if (provider === 'taobao') assert.equal(last.args.component.className, 'com.taobao.browser.BrowserActivity')
    else assert.equal(last.args.component, undefined)
  }
})
test('alarm, timer, SMS, settings and picker send primitives, not business tool JSON', async () => {
  const calls: any[] = []
  const handlers = deviceAppHandlers({ async request(capability, args) { calls.push({ capability, args }); return { ok: true } } })
  for (const [name, args] of [
    ['set_alarm_clock', { hour: '8', minute: '30', repeat_weekdays: '1,2' }],
    ['set_timer', {}], ['send_sms', { phone: '10086', text: 'fixture' }],
    ['open_settings_page', { page: 'wifi' }], ['show_input_method_picker', {}],
  ] as const) assert.equal(JSON.parse((await handlers[name]!(args, context)).content).ok, true)
  assert.equal(calls[0].args.action, 'android.intent.action.SET_ALARM')
  assert.equal(calls[0].args.extras['android.intent.extra.alarm.HOUR'], 8)
  assert.equal(calls[1].args.action, 'android.intent.action.SHOW_TIMERS')
  assert.equal(calls[2].args.action, 'android.intent.action.SENDTO')
  assert.equal(calls[3].args.action, 'android.settings.WIFI_SETTINGS')
  assert.equal(calls[4].capability, 'ime.show')
})
test('food empty keyword is home, explicit provider never falls back, unknown device outcome is preserved', async () => {
  const calls: any[] = []
  const handlers = deviceAppHandlers({ async request(capability, args) {
    calls.push({ capability, args }); return { ok: true, installed: true }
  } })
  const reply = await handlers['explore_food']!({ provider: 'meituan' }, context)
  assert.equal(JSON.parse(reply.content).action, 'food_home_requested')
  assert.equal(calls.at(-1).args.uri, 'imeituan://www.meituan.com/food/homepage')
  const failed = deviceAppHandlers({ async request() { return { ok: false, error: 'device_outcome_unknown' } } })
  assert.equal(JSON.parse((await failed['search_shopping']!({ provider: 'jd', keyword: '手机' }, context)).content).error, 'device_outcome_unknown')
})
test('uninstalled targets are reported, payment receive gaps are not fake success, approval tools remain absent', async () => {
  const missing = deviceAppHandlers({ async request() { return { ok: true, installed: false } } })
  assert.equal(JSON.parse((await missing['ride']!({ provider: 'alipay' }, context)).content).error, 'app_not_installed')
  const present = deviceAppHandlers({ async request() { return { ok: true, installed: true } } })
  assert.equal(JSON.parse((await present['pay']!({ provider: 'wechat', receive: true }, context)).content).error, 'unsupported_receive_provider')
  assert.equal(ANDROID_TOOL_CATALOG.some(command => ['confirm', 'cancel'].includes(command.name)), false)
  assert.equal('confirm' in present || 'cancel' in present, false)
})
