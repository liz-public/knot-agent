/** Attach recorded Provider timing to native read models, never synthetic delta chunks. */
export function recordedTiming(context: any) {
  const final = context.matches.findLast((match: any) => match.event.type === 'assistant/message')?.event
  const timing = final?.data.knotTiming
  if (!timing || !Number.isFinite(timing.durationMs) || timing.durationMs < 0 || !(final.time > 0)) return undefined
  const start = final.time - timing.durationMs
  return { stepStartTime: start, completedTime: final.time,
    firstTokenTime: Number.isFinite(timing.ttftMs) && timing.ttftMs >= 0 && timing.ttftMs <= timing.durationMs
      ? start + timing.ttftMs : null }
}

export function wireNativeTiming(ctx: any) {
  const registry = ctx.uiConversation.events
  const installed = new Set<string>()
  const update = () => {
    for (const definition of registry.entries()) {
      if (!['assistant-step', 'trajectory-assistant-step'].includes(definition.kind) || installed.has(definition.kind)) continue
      installed.add(definition.kind)
      const location = definition.buildLocationData, view = definition.buildViewNode
      if (location) definition.buildLocationData = (...args: any[]) => {
        const result = location(...args), timing = recordedTiming(args[0])
        return timing && result?.value?.finalNode ? { ...result, value: { ...result.value,
          finalNode: { ...result.value.finalNode, timing } } } : result
      }
      if (view) definition.buildViewNode = (context: any) => {
        const result = view(context), timing = recordedTiming(context)
        if (!timing || !result?.data?.node) return result
        return { ...result, data: { ...result.data, node: { ...result.data.node, timing },
          ...(result.data.request ? { request: { ...result.data.request, startedAt: timing.stepStartTime } } : {}) } }
      }
      ctx.effect(() => () => {
        definition.buildLocationData = location; definition.buildViewNode = view
      })
    }
  }
  ctx.effect(() => registry.subscribe(update))
  update()
}
