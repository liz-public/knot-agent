import type { WorkbenchAssemblyDefinition } from './assembly.js'
import { case1Assembly } from './case1-assembly.js'
import { case2Assembly } from './case2-assembly.js'

export type {
  AssemblyBuildOptions,
  AssemblyDescription,
  WorkbenchAssemblyDefinition,
} from './assembly.js'

export interface AssemblyCatalog {
  list(): readonly WorkbenchAssemblyDefinition[]
  get(id: string): WorkbenchAssemblyDefinition | undefined
}

/** A registry only: every description and executable factory belongs to its Assembly definition. */
export function createAssemblyCatalog(
  definitions: readonly WorkbenchAssemblyDefinition[] = [case1Assembly, case2Assembly],
): AssemblyCatalog {
  const byId = new Map(definitions.map(definition => [definition.description.id, definition]))
  if (byId.size !== definitions.length) throw new Error('duplicate assembly id')
  return {
    list: () => definitions,
    get: id => byId.get(id),
  }
}
