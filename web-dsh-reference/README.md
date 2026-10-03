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

## B1–B5: real Knot history, configuration, interaction and execution

Start the existing Knot Workbench Host on port 4317, then run:

```sh
VITE_KNOT_DSH_MODE=workbench npm run dev -- --port 4178 --strictPort
```

Open <http://127.0.0.1:4178/> and choose an existing Session in the sidebar.
`KNOT_WORKBENCH_URL` can override the development proxy target.
Chat, official Trajectory, child navigation and basic statistics share the same
snapshot projection. Text sending and live execution are connected. Unconnected actions explicitly refuse requests.

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
catalog updates outside the followed Session are not connected yet.

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

### B3 interaction ports

The original DSH approval and user-question Client plugins remain enabled.
For followed writable Sessions, the carrier subscribes to the existing Knot SSE
endpoint and translates `interaction.request` into a scoped `$events` waterfall.
The reply posts the exact interaction id to the existing Host `/interactions`
route. The Host broker, not this projection, owns waiting and execution.

- Concurrent approvals use the original single-card pending UI (DSH selects the
  displayed pending item; this integration does not impose FIFO).
- Approval arguments remain visible. Only `allowed-once` / `rejected` map to
  Knot `allow` / `deny`; no persistent permission grant is invented.
- Ask maps to one question with optional choices and free-text input. An answer
  must match that question; unknown choices, empty/skipped answers and multi-select
  do not resolve the broker.
- Pending requests replay when a Session stream reconnects. Duplicate deliveries
  are suppressed; stale/duplicate decisions and HTTP failures are not accepted.
  Session disposal withdraws presentation, never grants approval or answers Ask.
- Native Ask **close/skip are not Host cancellation operations**. Closing withdraws
  the card while the Host still waits; reopen/reload the Session to answer it.
  These visible native affordances need interaction refinement before treating
  the shell as a complete Run product. Cross-client settlement synchronization
  is not part of B3; this batch validates a single Client.

Browser smoke uses an isolated Host with the real HTTP server and broker, but no
model, tools or persistent data:

```sh
# Root build is required by the controlled Host fixture.
npm --prefix .. run build
node test/interaction-host.mjs
# In another terminal; type approvals / ask / free / status into the Host terminal.
VITE_KNOT_DSH_MODE=workbench KNOT_WORKBENCH_URL=http://127.0.0.1:4320 npm run dev -- --port 4179 --strictPort
```

### B4 online execution

- The native composer submits text through the existing Host `/messages` route.
  Pending model/approval configuration is committed by the Host's existing submit boundary.
  While running, Cmd/Ctrl+Enter uses Steering with the default DSH input preference.
  Queue requests are refused rather than silently converted to Steering; attachments remain unconnected.
- One followed Session's existing SSE supplies Journal invalidations, reasoning,
  content and tool-argument deltas. These become disposable DSH display events and
  dense assistant-stream frames, never new Knot Journal facts.
- The exact persisted assistant message settles its stream before the Step closes.
  HTTP snapshot refreshes append only unseen display records. Local prompt receipt
  identities retire native optimistic echoes, without altering persisted user messages.
- The native Stop button maps to **graceful pause**, not abort. S1 reuses that same
  InputBar primary button for Resume while paused; no second runtime control is shown.
- Bash stdout/stderr are expandable in a temporary live-output dock while the
  command runs. After close, the native tool row owns the persisted result. Its
  final result remains Knot JSON, not a fabricated DSH terminal payload.
- Runtime errors reach the native Session error surface and the dock. Switching
  Sessions closes the old SSE and discards transient presentation. Reopening/refreshing
  reads the complete Journal; missing live prefixes are not invented. An in-progress
  generation opened before this browser followed it appears in full after commitment.
- SSE reconnect refreshes durable history. It cannot reconstruct lost deltas from
  the Host (which retains no stream prefix); final commitment repairs the display.
  Reload/switch also drops the temporary live Bash console, not the underlying command.

Verified with a real DeepSeek CASE2 Session in an isolated temporary workspace:
read → approved Bash → Ask free-text reply → final, followed by a second Bash
with content + reasoning + tool call, graceful pause and resume. The final snapshot
has 2 turns, 5 model calls, 34 Journal facts and 8,727 request tokens (73.4% input-cache
hit). Refresh reconstructs the same persisted conversation. No repository files
were modified by that Session. These are smoke measurements, not performance claims.

### B5 business facts and inspection

- The original DSH statistics component still renders turns/steps. A public Client
  slot wrapper appends the Journal event count to its counts label, e.g.
  **2 turns 5 steps 34 events**, without copying the component or mutating its DOM.
- Total request tokens include all recorded model usage (including compaction).
  Older calls with unknown cache counts do not hide known token totals. Partial
  totals/cache coverage are explicitly labelled; unknown is not zero. The latest
  input-cache ratio and **end-to-end** output rate remain distinct from native decode TPS.
- Todo/Goal are derived only from `tool.result.state`, never guessed from a call
  or a denied operation. S1 connects the native Todo panel and read-only GoalBar.
  Native per-tool views receive presentation-only aliases for `todo.write`,
  `goal.write`, `spawn_agent` and `ask`; Journal/Context names remain unchanged.
  Native per-tool history/diff semantics are not fully equivalent to Knot's.
- **Knot Inspector** is a conversation tab alongside the unchanged native Chat
  and Trajectory. Context selects an actual `llm.invoke` and reads the existing
  Host `/context` projection. Journal filters raw events, initially shows the
  latest 100 and lazily expands their payloads. Plugin/protocol/tool metadata
  comes from `/studio`; it describes **current code**, not a historical code snapshot.
  Child Sessions come from the real parent relation and open in the native workspace.
- Inspector data is read-only. New carrier methods only call existing Host
  endpoints; no backend, Journal kernel, business plugin or dependency was added.

Verified against the real 1,134-event coding Session: 204 agent calls, 5 displayed
turns (Steering shares its active turn), 25,731,858 cumulative request tokens,
99.89% latest input-cache hit and Todo 7/7. Its 49-event child opens with the parent
breadcrumb. This Session has no Goal fact: Goal projection has controlled tests,
but a real online Goal interaction still needs user acceptance.

Remaining differences are intentional review items, not claims of DSH parity:
live-output layout flashes, refresh/stream scheduling,
custom configuration interactions, Ask close/skip, cross-client synchronization,
native specialized tool-result semantics and partial custom i18n. Historical
TTFT/decode timing, old cache counts and lost transient prefixes cannot be fabricated.

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

### S1 native presentation convergence

- `todos` feeds the original collapsible Todo panel. The custom Todo/Goal dock is removed.
- `goal` exposes only the observed objective, success criteria and phase. The published
  GoalBar renders active goals and hides completed ones. Its mutation controls are hidden
  and inert, with refusing callbacks; the original GoalService plugin is **not** activated.
  A view-only loader facade exports the unchanged component factory, not DSH backend RPC.
- The native InputBar's public component seat is wrapped once at assembly time, keeping
  its injected hooks, child-slot ownership and layout. Stop means graceful Pause;
  the same button means Resume when paused, preserving the unsent draft.
  The wrapper restores the original component on disposal. It does not copy native code.
- `knotRunState` initializes the view on load. Subsequent pause/resume transitions use
  the existing transient `knot/live` port: no new Journal fact or fake sequence is created.
  This matters because native durable projections reject equal-sequence updates.
- Sidebar activity uses the snapshot's actual last activity timestamp, never refresh time.
  Text-only shortcut replies count completed rounds, with zero model steps and no fabricated usage.

Verification: root 140 tests and Client 20 tests pass; both Workbench and fixture builds pass.
The real 1,134-event Session displays its original Todo panel. An isolated model-free Host
verifies active/completed Goal, Todo expansion, live Pause/Resume, draft preservation and
sidebar activity. No user Session facts, business plugins, Host APIs or Journal core changed.
For the isolated smoke above, select `s1-native` and use stdin `goal`, `todo`, `running`,
`pause`, `complete`; the native Resume button calls the real Host route.

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
The planned B1–B5 integration is connected, not every DSH product capability.
Further child control and native specialized tool presentation require separate review.
Native unsupported affordances (for example fork,
rename and feedback) still refuse writes; this is not yet a full DSH feature clone.
