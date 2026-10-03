/** Wrap an existing public slot once, including plugins that activate later. */
export function extendNativeSlot(ctx: any, slot: string, matches: (entry: any) => boolean, install: (entry: any) => void) {
  let installed = false
  const check = () => {
    if (installed) return
    const native = ctx.slots.entries(slot).find(matches)
    if (native) { installed = true; install(native) }
  }
  ctx.on('slots/changed', (key: string) => { if (key === slot) check() })
  check()
}
