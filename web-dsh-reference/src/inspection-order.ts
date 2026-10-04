/** Stable display ordering only: never reorder the underlying facts or Assembly. */
export function descending<T>(rows: readonly T[], value: (row: T) => number): T[] {
  return [...rows].sort((left, right) => value(right) - value(left))
}
