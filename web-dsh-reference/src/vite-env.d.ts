/// <reference types="vite/client" />

declare module 'virtual:dsh-fixture-boot' {
  export interface DshFixtureBoot {
    readonly graph: unknown
    readonly moduleLoaderFacade: string
    readonly bootstrapUrl: string
    readonly shellScriptUrl: string
    readonly shellStyleUrls: readonly string[]
  }

  const boot: DshFixtureBoot
  export default boot
}
