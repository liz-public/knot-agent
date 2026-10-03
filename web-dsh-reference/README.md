# DSH reference fixture

This isolated page boots the published DeepSeek Harness `0.2.0-rc.1` browser
shell and its real client plugin graph. The default entry uses deterministic
fixture data; B1 replaces the carrier with read-only Knot Workbench HTTP data.
It does not execute Knot cases, Journal plugins, or a DSH Host in the browser.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4175/>. The fixture includes multiple Sessions, a long
conversation, tool presentations, an Ask card, images, usage records, and the
original DSH trajectory view.

## B1: real Knot history (read-only)

Start the existing Knot Workbench Host on port 4317, then run:

```sh
VITE_KNOT_DSH_MODE=workbench npm run dev -- --port 4178 --strictPort
```

Open <http://127.0.0.1:4178/> and choose an existing Session in the sidebar.
`KNOT_WORKBENCH_URL` can override the development proxy target. Only GET requests
reach Knot. No model invocation, tool execution, or JSONL mutation happens.
Chat, official Trajectory, child navigation and basic statistics share the same
snapshot projection. Send is blocked. Unconnected mutation endpoints explicitly
refuse requests; some official controls (e.g. New Session) remain visible until B2.

The first visit without a saved selection can cause the official Client to try
creating a Session; the read-only carrier refuses it. Select an existing Session
manually. Missing historical model/cache/stream timing is not filled with defaults.

```text
DSH published Client → workbench-remote → existing Knot HTTP API
                           ↓
                temporary history projection
```

`fixture-remote.ts` and captured DSH JSON are not used by this mode. Workbench
types are imported as types only; the backend has no dependency on DSH UI types.
The Vite proxy is for development, not a production deployment configuration.

```sh
npm test
VITE_KNOT_DSH_MODE=workbench npm run build
```

## Boundary

```text
DSH published Web shell + client plugins
                  |
             RemoteMock
                  |
       assembled fixture JSON
```

`vite.config.ts` derives the browser plugin roster from the published
`dsh-base` and `dsh-web-app` manifests, serves their built `client.js`
artifacts, and copies the published frontend dist during production builds.
No DSH UI source is copied into this directory. `src/fixture-remote.ts` is an
adaptation of DSH's MIT-licensed assembled-client test carrier.

This is a reference integration, not yet the default Knot product frontend.
Online output, configuration, approvals and Ask are later wiring batches.
