/** Native presentation only; counters and state folding share the Host's pure projection. */
import type { SessionSnapshotDto } from '../../src/workbench/session.js'
import { projectSessionFacts } from '../../src/workbench/session-facts.ts'

export function projectBusinessState({ events }: SessionSnapshotDto) {
  const { todos, goal, usage } = projectSessionFacts(events)
  return { todos, knotUsage: usage, goal: goal === null ? null : { goal: {
    objective: goal.objective, successCriteria: goal.successCriteria,
    phase: goal.status === 'completed' ? 'complete' : 'active',
  } } }
}
