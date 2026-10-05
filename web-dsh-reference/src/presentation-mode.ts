/** A missing switch must never silently disconnect the UI from the real Host. */
export function presentationMode(value: string | undefined): 'workbench' | 'fixture' {
  if (value === undefined || value === 'workbench') return 'workbench'
  if (value === 'fixture') return 'fixture'
  throw new Error('VITE_KNOT_DSH_MODE must be workbench or fixture')
}
