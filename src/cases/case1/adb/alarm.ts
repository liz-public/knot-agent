/** Map catalog weekday 1=Mon … 7=Sun to Android Calendar day constants. */
export function parseAlarmRepeatWeekdays(raw: string): number[] | undefined {
  const days: number[] = []
  for (const token of raw.split(',').map(item => item.trim()).filter(Boolean)) {
    const iso = Number(token)
    const calendar = iso === 1 ? 2
      : iso === 2 ? 3
        : iso === 3 ? 4
          : iso === 4 ? 5
            : iso === 5 ? 6
              : iso === 6 ? 7
                : iso === 7 ? 1
                  : Number.NaN
    if (!Number.isInteger(calendar)) return undefined
    if (!days.includes(calendar)) days.push(calendar)
  }
  return days.length > 0 ? days : undefined
}
