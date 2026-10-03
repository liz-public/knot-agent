/** Presentation-only translation; the existing Knot broker owns waiting and resolution. */
import type { InteractionRequestDto } from '../../src/workbench/session.js'

export function interactionFrame(sessionId: string, interaction: InteractionRequestDto) {
  return {
    type: 'waterfall', agentId: sessionId,
    eventId: JSON.stringify([sessionId, interaction.id]),
    event: interaction.kind === 'approval' ? 'approval/request' : 'user-questions/request',
    request: interaction.kind === 'approval'
      ? { toolName: interaction.toolName, reason: `${interaction.toolName}\n${JSON.stringify(interaction.arguments, null, 2)}` }
      : { questions: [{ id: interaction.id, question: interaction.question,
        ...(interaction.choices ? { options: interaction.choices.map(label => ({ label })) } : {}),
      }] },
  }
}

export function interactionAnswer(interaction: InteractionRequestDto, value: unknown): string {
  if (interaction.kind === 'approval') {
    if (value === 'allowed-once') return 'allow'
    if (value === 'rejected') return 'deny'
    throw new Error('Unsupported approval decision')
  }
  const answers = (value as { answers?: { id: string; selected: string[]; custom?: string }[] } | null)?.answers
  if (!Array.isArray(answers) || answers.length !== 1 || answers[0]?.id !== interaction.id) {
    throw new Error('Ask answer does not match its question')
  }
  const answer = answers[0]
  if (typeof answer.custom === 'string' && answer.custom.trim()) return answer.custom
  if (Array.isArray(answer.selected) && answer.selected.length === 1
    && interaction.choices?.includes(answer.selected[0]!)) return answer.selected[0]!
  throw new Error('Ask requires one choice or a free-text answer; skipping is not supported')
}
