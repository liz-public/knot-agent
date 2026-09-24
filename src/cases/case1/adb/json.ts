import type { ToolExecution } from '../tools.js'

export const ok = (
  data: Record<string, unknown>,
  hint: string,
  state?: ToolExecution['state'],
): ToolExecution => ({
  content: JSON.stringify({ ok: true, ...data, hint }),
  ...(state === undefined ? {} : { state }),
})

export const err = (error: string, hint = '', extra: Record<string, unknown> = {}): ToolExecution => ({
  content: JSON.stringify({ ok: false, error, hint, ...extra }),
})
