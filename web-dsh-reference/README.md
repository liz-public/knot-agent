# DSH reference fixture

This isolated page boots the published DeepSeek Harness `0.2.0-rc.1` browser
shell and its real client plugin graph. The default entry uses deterministic
fixture data; Workbench mode replaces the carrier with Knot HTTP data.
It does not execute Knot cases, Journal plugins, or a DSH Host in the browser.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4175/>. The fixture includes multiple Sessions, a long
conversation, tool presentations, an Ask card, images, usage records, and the
original DSH trajectory view.

## B1/B2: real Knot history and configuration

Start the existing Knot Workbench Host on port 4317, then run:

```sh
VITE_KNOT_DSH_MODE=workbench npm run dev -- --port 4178 --strictPort
```

Open <http://127.0.0.1:4178/> and choose an existing Session in the sidebar.
`KNOT_WORKBENCH_URL` can override the development proxy target.
Chat, official Trajectory, child navigation and basic statistics share the same
snapshot projection. Send remains blocked. Unconnected actions explicitly refuse requests.

The first visit without a saved selection can cause the official Client to create
a blank Session with Host defaults. Missing historical usage/timing is not filled with defaults.

### B2 controls

- **Settings → 模型 Provider**: existing Host list, add/edit/test/delete/default operations.
  Testing is an explicit, confirmed real LLM request. Environment profiles are read-only.
  API keys are write-only to the Host and are never read back or saved to browser storage.
- **Settings → 新建 Session**: choose a Host-provided Assembly, workspace, Provider,
  reasoning effort and approval policy before creation. Native sidebar New uses Host defaults.
- **Composer model/approval chips**: read and update the selected Session's pending configuration.
  Saving does not append Journal events; the existing Host commits them at the next submit boundary.
  Read-only/running Sessions cannot be reconfigured. Auto means automatic approval without a sandbox,
  not DSH's automated approval review.

The published Settings shell, primitives and theme are reused. A small Knot Client contribution
owns these configuration surfaces because Knot's Provider profiles and immutable Session Assembly
are not DSH's settings schemas, credential store, agent preset switching or permission presets.
Pending selections are read from the Host summary, not fabricated as sequenced history projections.
Only acknowledged local creation mutations notify the Client catalog in B2; cross-client
updates and online execution streams are not connected yet.

### Accepted presentation differences (B2)

Workbench mode disables the original DSH model-selection, permission-preset and
model-settings Client plugins and installs the Knot configuration contribution.
This is an accepted intermediate integration, **not a 1:1 DSH interaction replica**.

- Composer controls open a combined model/approval modal with native selects,
  rather than the original DSH dropdown menus.
- Provider management and New Session are custom Settings sections; their forms,
  layout and creation entry point differ from the original surfaces.

The data/semantic differences explain separate capability owners, but do not
require these presentation differences. After wiring, review whether the Knot
contribution can reuse more original menu/form interactions without inventing
DSH settings, permission-review or preset-switching backend semantics.

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
Online output, approvals and Ask are later wiring batches. Total-token/cache-rate/event-count
display reconciliation remains part of the later statistics batch.
