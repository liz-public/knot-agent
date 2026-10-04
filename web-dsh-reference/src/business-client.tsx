/** Knot-only presentation contributions; native DSH Chat/Trajectory stay intact. */
import { useMemo } from 'react'
import { GoalBar } from '@deepseek-ai/dsh-client-ui-goal/client'
import { extendNativeSlot } from './native-slot.ts'
import { answerableQuestion } from './interaction-projection.ts'
import { nativeToolProps } from './tool-presentation.ts'

const percent = (value: number) => (value * 100).toFixed(2) + '%'

const readonlyGoalAction = async () => ({ ok: false as const, error: { code: 'knot/read-only', message: 'Goal is read-only', details: {} } })
function ReadonlyGoal({ useProjection }: any) {
  const goal = useProjection('goal')?.goal
  if (!goal || goal.phase === 'complete') return null
  // The published GoalBar has no readOnly prop. Hide its mutation controls and
  // make the native subtree inert; do not activate ui-goal or fabricate goals RPC.
  return <div className="knot-goal-readonly" {...{ inert: '' }} title={goal.successCriteria?.join('\n')}>
    <GoalBar goal={goal} onEdit={readonlyGoalAction} onPause={readonlyGoalAction}
      onResume={readonlyGoalAction} onClear={readonlyGoalAction}
      t={() => document.documentElement.lang.startsWith('zh') ? '进行中的目标（只读）' : 'Ongoing goal (read-only)'} />
  </div>
}

export const inject = ['slots']
export function apply(ctx: any) {
  // Client plugins activate when their services arrive, not merely in bundle order.
  // Public SlotRegistry entries + shadowing: keep the original component and its hooks/styles.
  extendNativeSlot(ctx, 'conversation.composer.dock', entry => entry.options.id === 'stats', native => {
    const Original = native.component
    function Stats(props: any) {
      const events = props.useProjection('knotEventCount')
      const usage = props.useProjection('knotUsage')
      const nativeUsage = props.useProjection('tokenUsage')
      const stats = props.useProjection('sessionStats')
      return <div className="knot-stats-inline">
        <Original {...props} t={(key: string, params: any) => key === 'stats.counts' && typeof events === 'number'
          ? props.t(key, params) + (document.documentElement.lang.startsWith('zh') ? ` ${events} 事件` : ` ${events} events`) : props.t(key, params)} />
        {stats?.turns > 0 && stats.steps === 0 && !nativeUsage && <span>
          {props.t('stats.counts', { turns: stats.turns, steps: 0 })}{typeof events === 'number' ? ` · ${events} ${document.documentElement.lang.startsWith('zh') ? '事件' : 'events'}` : ''}
        </span>}
        {usage?.knownCalls > 0 && !nativeUsage && <details><summary>{usage.totalTokens.toLocaleString()} tok{usage.knownCalls < usage.calls ? '（部分）' : ''}</summary>
          <p>输入 {usage.inputTokens.toLocaleString()} · 输出 {usage.outputTokens.toLocaleString()} · Usage {usage.knownCalls}/{usage.calls} 次</p>
          <p>历史缓存计数 {usage.cacheKnownCalls}/{usage.calls} 次；{usage.knownCacheHitRate === undefined ? '缓存未知' : '已知调用加权缓存率 ' + percent(usage.knownCacheHitRate)}</p></details>}
        {typeof usage?.latest.cacheHitRate === 'number' && !nativeUsage && <span>本次缓存 {percent(usage.latest.cacheHitRate)}</span>}
        {typeof usage?.latest.outputRate === 'number' && <span title="输出 token / invoke→generated 总时长；不是 DSH decode TPS">端到端 {usage.latest.outputRate.toFixed(1)} tok/s</span>}
      </div>
    }
    ctx.slots.register({ name: 'conversation.composer.dock', id: 'stats', order: 0, priority: -10,
      locale: native.locale, inject: native.inject }, Stats)
  })
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'goal', order: 10 }, ReadonlyGoal))
  // Native QuestionFlow catches rejected verbs and keeps the question visible.
  extendNativeSlot(ctx, 'conversation.composer', entry => entry.locale === 'question', native => {
    const Original = native.component
    function Question(props: any) {
      const matched = useMemo(() => answerableQuestion(props.matched,
        document.documentElement.lang.startsWith('zh')
          ? '此 Ask 不支持取消；请回答问题。取消未提交，模型仍在等待。'
          : 'This Ask cannot be cancelled. Please answer; the agent is still waiting.'), [props.matched, props.t])
      return <Original {...props} matched={matched} />
    }
    ctx.effect(() => { native.component = Question; return () => { native.component = Original } })
  })
  // Native card field adaptation only. Facts/Context/Trajectory keep Knot names.
  for (const [name, nativeName] of [['read', 'read'], ['write', 'write'], ['edit', 'edit'], ['bash', 'bash'],
    ['todo.write', 'todo_write'], ['goal.write', 'update_goal'], ['spawn_agent', 'subagent'], ['ask', 'ask_user_question'], ['web_search', 'web_search']]) {
    extendNativeSlot(ctx, 'tool.call.toolview', entry => entry.options.key === nativeName, native => {
      const Original = native.component
      const Card = (props: any) => <Original {...nativeToolProps(props)} />
      if (name === nativeName) ctx.effect(() => { native.component = Card; return () => { native.component = Original } })
      else ctx.slots.register({ name: 'tool.call.toolview', key: name, locale: native.locale, inject: native.inject }, Card)
    })
  }
}
