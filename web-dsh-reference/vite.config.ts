import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import * as appBoot from '@deepseek-ai/dsh-app-boot'
import { bootInjections, orderByModuleGraph } from '@deepseek-ai/dsh-client-modules'
import { defineConfig, type Plugin } from 'vite'
import { readonlyClientFactory } from './src/readonly-client.ts'
import { buildSync } from 'esbuild'

const VIRTUAL_BOOT = 'virtual:dsh-fixture-boot'
const RESOLVED_VIRTUAL_BOOT = `\0${VIRTUAL_BOOT}`
const VIRTUAL_KNOT_JOURNAL = 'virtual:knot-journal-fixture'
const RESOLVED_VIRTUAL_KNOT_JOURNAL = `\0${VIRTUAL_KNOT_JOURNAL}`
const REVISION = 'dsh-0.2.0-rc.1-fixture'
const BOOTSTRAP_ID = '@deepseek-ai/dsh-client-modules'

interface PackageManifest {
  readonly name?: string
  readonly dsh?: {
    readonly bundle?: { readonly patch: string | string[] }
    readonly client?: {
      readonly platform: string
      readonly inject?: string[]
      readonly external?: string[]
      readonly immediately?: boolean
    }
  }
}

interface ComposedEntry {
  readonly name?: unknown
  readonly disabled?: unknown
}

interface ClientEntry {
  readonly id: string
  readonly url: string
  readonly rev: string
  readonly inject?: string[]
  readonly external?: string[]
  readonly immediately?: boolean
  readonly bundlePath: string
}

function packageRoot(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier
}

function dshClientFixture(): Plugin {
  const require = createRequire(import.meta.url)
  const shellPackage = require.resolve('@deepseek-ai/dsh-web-frontend/package.json')
  const shellDist = join(dirname(shellPackage), 'dist')
  const shellIndex = readFileSync(join(shellDist, 'index.html'), 'utf8')
  const shellScript = shellIndex.match(/<script[^>]+src="\.\/(.+?)"/)?.[1]
  const shellStyles = [...shellIndex.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.\/(.+?)"/g)]
    .map(match => match[1])
    .filter((path): path is string => path !== undefined)
  if (shellScript === undefined) throw new Error('published DSH frontend has no module entry')
  const bundleNames = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  const entries = appBoot.composeEntries(bundleNames.map((name) => {
    const manifestPath = require.resolve(`${name}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    const bundle = manifest.dsh?.bundle
    if (bundle === undefined) throw new Error(`${name} has no DSH bundle declaration`)
    return appBoot.bundlePatchPaths(dirname(manifestPath), bundle)
      .flatMap(path => appBoot.loadOverlayPatches('knot-dsh-fixture', path))
  })) as readonly ComposedEntry[]

  const unordered: ClientEntry[] = []
  const readOnly = process.env['VITE_KNOT_DSH_MODE'] === 'workbench'
  const localClients = [
    { name: 'configuration', inject: ['@deepseek-ai/dsh-client-ui-workspace', '@deepseek-ai/dsh-client-ui-primitives'] },
    { name: 'business', inject: ['@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-ui-tool', '@deepseek-ai/dsh-client-ui-goal'] },
    { name: 'cover', inject: ['@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-primitives'] },
    ...['journal', 'tools', 'context', 'plugins'].map(name => ({ name,
      inject: ['@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-primitives'] })),
  ]
  const localStyles = ['configuration', 'business', 'inspection', 'cover']
  // UI-only capability owners are hidden until their Knot operations are connected.
  const unconnectedUi = new Set(['ui-model-selection', 'ui-agent-preset', 'ui-permission-presets',
    'ui-plan', 'ui-jobs', 'ui-plugin-manager', 'ui-cordis', 'ui-attachment',
    'ui-settings-models', 'ui-settings-account', 'ui-settings-plugins', 'ui-settings-plugin-inventory'])
  for (const entry of entries) {
    if (entry.disabled === true || typeof entry.name !== 'string') continue
    if (readOnly && unconnectedUi.has(entry.name.replace('@deepseek-ai/dsh-client-', ''))) continue
    const root = packageRoot(entry.name)
    let manifestPath: string
    try {
      manifestPath = require.resolve(`${root}/package.json`)
    } catch {
      continue
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    const declaration = manifest.dsh?.client
    if (manifest.name !== entry.name || declaration?.platform !== 'web') continue
    const index = unordered.length.toString().padStart(3, '0')
    const goalViewOnly = readOnly && entry.name === '@deepseek-ai/dsh-client-ui-goal'
    unordered.push({
      id: entry.name,
      url: `/dsh-plugins/${index}.js`,
      rev: REVISION,
      bundlePath: require.resolve(`${entry.name}/client`),
      ...(goalViewOnly ? { inject: ['@deepseek-ai/dsh-client-ui-primitives'] }
        : declaration.inject === undefined ? {} : { inject: declaration.inject }),
      ...(declaration.external === undefined ? {} : { external: declaration.external }),
      ...(declaration.immediately === true ? { immediately: true } : {}),
    })
  }

  const byId = new Map(unordered.map(entry => [entry.id, entry]))
  const plugins = orderByModuleGraph(unordered).map(({ id }) => {
    const entry = byId.get(id)
    if (entry === undefined) throw new Error(`ordered unknown DSH client package ${id}`)
    return entry
  })
  if (readOnly) plugins.push({ id: '@knot-agent/client-readonly', url: '/dsh-plugins/readonly.js', rev: REVISION,
    bundlePath: '', inject: ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-ui-conversation'] })
  if (readOnly) for (const client of localClients) plugins.push({ id: `@knot-agent/client-${client.name}`,
    url: `/dsh-plugins/${client.name}.js`, rev: REVISION, bundlePath: '', inject: client.inject,
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives',
      ...(client.name === 'business' ? ['@deepseek-ai/dsh-client-ui-goal/client'] : [])] })
  const bootstrapEntries = plugins.filter(entry => entry.id === BOOTSTRAP_ID)
  const applicationEntries = plugins.filter(entry => entry.id !== BOOTSTRAP_ID)
  const graph = {
    rev: REVISION,
    entries: plugins.map(({ bundlePath: _bundlePath, ...entry }) => entry),
    batches: [
      {
        phase: 'bootstrap' as const,
        url: '/dsh-plugins/bootstrap.js',
        rev: REVISION,
        entries: bootstrapEntries.map(entry => entry.id),
      },
      {
        phase: 'application' as const,
        url: '/dsh-plugins/application.js',
        rev: REVISION,
        entries: applicationEntries.map(entry => entry.id),
      },
    ],
  }
  const [facade] = bootInjections(graph)
  if (facade?.kind !== 'script') throw new Error('DSH ModuleLoader facade injection is missing')

  const sources = new Map<string, string | Buffer>()
  sources.set('/DSH-LICENSE.txt', readFileSync(join(import.meta.dirname, 'DSH-LICENSE.txt'), 'utf8'))
  const clientSource = (name: string, id: string) => {
    const compiled = buildSync({ entryPoints: [join(import.meta.dirname, `src/${name}-client.tsx`)],
      bundle: true, write: false, format: 'cjs', jsx: 'automatic',
      external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-goal/client'],
    }).outputFiles[0]!.text
    return `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{var module={exports:{}};var exports=module.exports;${compiled}\nreturn module.exports;}})`
  }
  for (const entry of plugins) {
    let source: string
    const local = localClients.find(client => entry.id === `@knot-agent/client-${client.name}`)
    if (local) source = clientSource(local.name, entry.id)
    else source = entry.bundlePath === ''
      ? `window.__ModuleLoader__.load({id:'@knot-agent/client-readonly',factory:${readonlyClientFactory.toString()}})`
      : readFileSync(entry.bundlePath, 'utf8')
    if (readOnly && entry.id === '@deepseek-ai/dsh-client-ui-goal') {
      // Load the unchanged published factory as a view library. Its full apply()
      // is deliberately not activated: Knot exposes no GoalService mutation RPC.
      source = `window.__ModuleLoader__.load({id:${JSON.stringify(entry.id)},factory:(require)=>{let registration;const window={__ModuleLoader__:{load:(value)=>{registration=value}}};${source}\nreturn {GoalBar:registration.factory(require).GoalBar,apply(){}};}})`
    }
    sources.set(entry.url, source)
  }
  if (readOnly) for (const name of localStyles) sources.set(`/knot-${name}.css`, readFileSync(join(import.meta.dirname, `src/${name}-client.css`)))
  sources.set('/dsh-plugins/bootstrap.js', bootstrapEntries
    .map(entry => String(sources.get(entry.url) ?? ''))
    .join('\n;\n'))
  sources.set('/dsh-plugins/application.js', applicationEntries
    .map(entry => String(sources.get(entry.url) ?? ''))
    .join('\n;\n'))
  const pending = [shellDist]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (directory === undefined) continue
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) pending.push(path)
      else sources.set(`/dsh-shell/${relative(shellDist, path)}`, readFileSync(path))
    }
  }

  return {
    name: 'knot-dsh-client-fixture',
    buildStart() {
      if (readOnly) for (const name of readdirSync(join(import.meta.dirname, 'src')).filter(name => /\.(tsx?|css)$/.test(name)))
        this.addWatchFile(join(import.meta.dirname, 'src', name))
    },
    handleHotUpdate(context) {
      if (readOnly && context.file.startsWith(join(import.meta.dirname, 'src') + '/') && /\.(tsx?|css)$/.test(context.file)) {
        for (const { name } of localClients) sources.set(`/dsh-plugins/${name}.js`, clientSource(name, `@knot-agent/client-${name}`))
        for (const name of localStyles) sources.set(`/knot-${name}.css`, readFileSync(join(import.meta.dirname, `src/${name}-client.css`)))
        sources.set('/dsh-plugins/application.js', applicationEntries.map(entry => String(sources.get(entry.url) ?? '')).join('\n;\n'))
        context.server.ws.send({ type: 'full-reload' })
        return []
      }
    },
    resolveId(id) {
      if (id === VIRTUAL_BOOT) return RESOLVED_VIRTUAL_BOOT
      if (id === VIRTUAL_KNOT_JOURNAL) return RESOLVED_VIRTUAL_KNOT_JOURNAL
      return undefined
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_KNOT_JOURNAL) {
        const requested = process.env['KNOT_DSH_JOURNAL']
        if (requested === undefined || requested.trim().length === 0) return 'export default null'
        const path = isAbsolute(requested) ? requested : resolve(dirname(import.meta.dirname), requested)
        if (!existsSync(path)) throw new Error(`KNOT_DSH_JOURNAL does not exist: ${path}`)
        return `export default ${JSON.stringify({ path, raw: readFileSync(path, 'utf8') })}`
      }
      if (id !== RESOLVED_VIRTUAL_BOOT) return undefined
      return `export default ${JSON.stringify({
        graph,
        moduleLoaderFacade: facade.text,
        bootstrapUrl: '/dsh-plugins/bootstrap.js',
        shellScriptUrl: `/dsh-shell/${shellScript}`,
        shellStyleUrls: [...shellStyles.map(path => `/dsh-shell/${path}`), ...(readOnly ? localStyles.map(name => `/knot-${name}.css`) : [])],
      })}`
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?', 1)[0]
        if (path === undefined) return next()
        const source = sources.get(path)
        if (source === undefined) return next()
        response.statusCode = 200
        response.setHeader('Content-Type', path.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : path.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(source)
      })
    },
    generateBundle() {
      for (const [url, source] of sources) {
        this.emitFile({
          type: 'asset',
          fileName: url.slice(1),
          source,
        })
      }
    },
  }
}

export default defineConfig({
  plugins: [dshClientFixture()],
  server: {
    host: '127.0.0.1',
    port: 4175,
    proxy: { '/api/workbench': process.env['KNOT_WORKBENCH_URL'] ?? 'http://127.0.0.1:4317' },
  },
  preview: {
    host: '127.0.0.1',
    port: 4175,
  },
})
