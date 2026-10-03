import boot from 'virtual:dsh-fixture-boot'
import knotJournal from 'virtual:knot-journal-fixture'
import { createAssembledRemote } from './fixture-remote.ts'
import { projectKnotJournal } from './knot-journal-projection.ts'
import { createWorkbenchRemote } from './workbench-remote.ts'

interface FixtureWindow extends Window {
  __DSH_BOOT__?: unknown
  __DSH_TRANSPORT__?: {
    readonly rpc: ReturnType<typeof createWorkbenchRemote>
    readonly loadBundle: typeof evaluateBundle
  }
}

async function evaluateBundle(url: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`DSH fixture bundle ${url} returned HTTP ${response.status}`)
  const source = await response.text()
  ;(0, eval)(source)
}

async function main(): Promise<void> {
  if (import.meta.env.VITE_KNOT_DSH_MODE === 'workbench') document.title = 'Knot · DSH Run · Read-only'
  const fixtureWindow = window as FixtureWindow
  fixtureWindow.__DSH_BOOT__ = boot.graph
  ;(0, eval)(boot.moduleLoaderFacade)
  await evaluateBundle(boot.bootstrapUrl)

  const rpc = import.meta.env.VITE_KNOT_DSH_MODE === 'workbench'
    ? createWorkbenchRemote()
    : createAssembledRemote({
        ...(knotJournal === null ? {} : { journal: projectKnotJournal(knotJournal.raw, knotJournal.path) }),
      }).mock.rpc
  fixtureWindow.__DSH_TRANSPORT__ = { rpc, loadBundle: evaluateBundle }

  for (const href of boot.shellStyleUrls) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.append(link)
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = boot.shellScriptUrl
    script.onload = () => { resolve() }
    script.onerror = () => { reject(new Error(`DSH shell failed to load ${boot.shellScriptUrl}`)) }
    document.head.append(script)
  })
}

void main().catch((error: unknown) => {
  console.error(error)
  const root = document.getElementById('root')
  if (root !== null) root.textContent = error instanceof Error ? error.message : String(error)
})
