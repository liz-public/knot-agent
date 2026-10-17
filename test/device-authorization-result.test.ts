import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceResult } from '../src/cases/case1/device-result.js'

test('all settings authorizations return an end-turn hint, not success or denial', () => {
  for (const [access, label] of Object.entries({ WriteSettings: '修改系统设置', NotificationPolicy: '勿扰模式访问',
    NotificationListener: '通知使用权', Accessibility: '无障碍服务' })) {
    const reply = JSON.parse(deviceResult({ ok: false, error: 'system_access_required', access, settings_opened: true }, {}, '').content)
    assert.equal(reply.ok, false)
    assert.equal(reply.error, 'system_access_required')
    assert.ok(reply.hint.includes(label))
    assert.match(reply.hint, /当前连接的助手应用/)
    assert.match(reply.hint, /原操作尚未执行/)
    assert.match(reply.hint, /本轮结束，不要重试工具/)
  }
})
