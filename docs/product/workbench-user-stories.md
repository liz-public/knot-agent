# Knot Workbench product user stories

Status: product capability ledger for review, not a frozen public contract

Baseline: `91f2200` (`main`, 2026-10-04); refreshed after B1–B5 / S1–S5

Scope: current **DSH Run**, earlier custom **Web/Studio**, and shared Host capabilities.
The surfaces are not interchangeable: DSH Run does not contain a Studio editor.

Next implementation phase: separately reviewed. This ledger does not authorize feature work.

## 1. Purpose

This document answers three concrete questions:

1. What can a user do in the Workbench today?
2. Which visible controls are real, partial, fixture-backed, missing, or explicitly deferred?
3. What complete Run and Studio experiences is the current product shape aiming at?

It is not a backlog where every missing row must be implemented. A missing feature becomes work only
after a separate priority decision. This keeps product completeness visible without making the
Journal kernel or CASE2 pay for every product idea in advance.

## 2. Status and evidence rules

| Status | Meaning |
|---|---|
| **Implemented** | The end-to-end behavior is real, wired to the Host/runtime, and has code or test evidence. |
| **Partial** | A useful real path exists, but a material part of the stated acceptance criteria is absent. |
| **Fixture** | The UI demonstrates the intended behavior using local/static state; it is not a durable product capability. |
| **Missing** | The story is in the intended product surface but has no useful implementation yet. |
| **Deferred** | Deliberately excluded until a concrete case establishes the boundary. |

Status applies to the acceptance criteria, not a quality score. No weighted completion percentage
is reported: the two frontends expose different surfaces, and absent Generation support is not
partially implemented just because a declaration can be displayed.

Evidence abbreviations:

- **DSH:** `web-dsh-reference/src/*-client.tsx`, `workbench-remote.ts`, `knot-journal-projection.ts`
- **Earlier Web:** `web/src/App.tsx`, `web/src/journal-api.ts`, `web/src/studio/StudioView.tsx`
- **HTTP:** `src/workbench/http-server.ts`
- **Session:** `src/workbench/session.ts`, `src/workbench/live-session.ts`
- **Host:** `src/workbench/run.ts`
- **CASE2:** `src/cases/case2/`
- **WB tests:** `test/workbench.test.ts`, `test/workbench-live.test.ts`
- **CASE2 tests:** `test/case2.test.ts`
- **Integration tests:** `web-dsh-reference/test/*.test.ts`, `test/session-inspection.test.ts`, `test/session-cover.test.ts`
- **Real run:** saved coding Session inspected at 1,134 facts; saved `B2 configuration smoke` at 288 facts.
  These are historical observations, not immutable end-to-end reproducibility benchmarks.

## 3. Completion view

### 3.1 Current surface view

| Surface | Real path | Material limits |
|---|---|---|
| DSH Run | Sessions, online execution, configuration, approval/Ask, native cards/Todo, read-only Goal, inspection, cover | No fork/attachments/Jobs/dynamic plugins/sandbox; custom configuration and live Bash layout |
| Earlier Web / Studio | Persistent Project/Case/Run, current Assembly inspection, Mock/real runs and Flow lists | No Generation/Publish/Validation, visual composition editor, Dataset Eval or comparison |
| Shared Host | Provider CRUD/test/default, Journal-backed configuration, persistent child Sessions, read-only analysis | Local-only deployment; no immutable historical runtime artifacts |

### 3.2 Interpretation

Run is usable, not a full DSH clone. Assembly declarations now share their executable source;
Context is real, not Fixture. Studio scope was reduced deliberately. Unknown timing/cache/diff
facts and approximate subscription counts must remain labelled. The immediate direction is real
CASE2 use and observed-problem fixes, not implementing every missing story below.

## 4. Run mode stories

### 4.1 Project and workspace

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-P01 | As a user, I can see the selected Session's workspace. | Switching Session changes its displayed workspace; no invented branch status. | **Implemented** | DSH cover, native workspace/sidebar and Host summary; earlier Web header. |
| RUN-P02 | As a user, I can switch saved Projects. | Selection scopes the Project inventory and persists. | **Partial** | Earlier Web uses persisted Studio Projects. DSH workspace navigation is not a Project selector. |
| RUN-P03 | As a user, I can create a Project rooted at a workspace. | Host stores metadata and one registered Assembly identity. | **Partial** | Host `/studio/projects` and earlier Web are real; DSH has no Project-authoring surface, and creation does not author an Assembly. |
| RUN-P04 | As a user, I can choose a local workspace without manually typing a path. | A desktop/host-mediated directory picker returns a Host-valid path without browser path spoofing. | **Deferred** | Ordinary browser directory APIs do not disclose a portable absolute Host path. Requires a desktop/Host picker boundary. |
| RUN-P05 | As a user, I can see real repository branch and working-tree state. | Branch/status are derived from the selected workspace and update after tools change it. | **Partial** | Workspace is real; `main` is currently presentation text, not repository observation. |
| RUN-P06 | As an operator, I can prevent an Agent from silently escaping its assigned workspace through coding file tools. | read/write/edit reject paths outside the workspace and report a model-visible failure. | **Implemented** | `workspacePath()` in `coding-tools.ts`; CASE2 tests. Bash remains intentionally policy-controlled rather than path-rewritten. |

### 4.2 Session lifecycle

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-S01 | As a user, I can list and switch Sessions without stopping them. | Selection loads durable history/live stream; external catalog changes are discoverable. | **Partial** | Native list/follow and acknowledged local creation work; global external new-Session discovery still needs Refresh. |
| RUN-S02 | As a user, I can create a Session with title, workspace and pending model/approval choices. | Host creates persistent identity/runtime; configuration is not committed until submit. | **Implemented** | DSH Settings New Session; existing POST route; `test/workbench-live.test.ts`. |
| RUN-S03 | As a user, I can continue a completed idle Session after Host restart. | Descriptor and JSONL restore; a new message produces a distinct turn without replaying old handlers. | **Implemented** | `loadSessionDescriptors`; host reconstruction test; CASE2 JSONL restore test. |
| RUN-S04 | As a user, I can run multiple Sessions concurrently without state crossing. | Workspace, Journal, live events, interactions, and run state remain isolated. | **Implemented** | `two live sessions run concurrently...` WB test. |
| RUN-S05 | As a user, I can open parent/child Session traces. | Child has its own Journal and navigation back to its parent. | **Implemented** | Native child navigation/breadcrumb; persistent parentSessionId; carrier tests. |
| RUN-S06 | As a user, I can rename a Session. | Rename persists and updates every open catalog subscriber. | **Missing** | Title is descriptor-owned but no update command exists. |
| RUN-S07 | As a user, I can archive or remove an obsolete Session. | The action is explicit, recoverability is stated, and catalog/session artifacts are handled consistently. | **Missing** | No lifecycle command beyond create. |
| RUN-S08 | As a user, I can fork a Session at its current head. | A new Session receives a causally valid seed and independent future Journal while retaining lineage. | **Missing** | `parentSessionId` currently means subagent ownership, not history lineage. |
| RUN-S09 | As a user, I can explore an earlier event without mutating the append-only source. | Selecting an event creates a branch/fork from that boundary; original JSONL remains unchanged. | **Missing** | Intended replacement for destructive rewind. Requires a seed/projection boundary. |
| RUN-S10 | As a user, I can export or import a Session for diagnosis. | Export has a documented portable envelope and import never executes old events as handlers. | **Missing** | Raw JSONL can be copied manually; no product contract. |

### 4.3 Agent configuration

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-C01 | As a user, I can see configured Provider profiles without exposing credentials. | Browser receives id/label/adapter/model/configured state only. | **Implemented** | `ProviderProfileSummary`; provider-profile tests. |
| RUN-C02 | As a user, I can choose a Provider/model for the next request. | Host owns pending selection; submit commits changed inference.configured, then resolves Provider from Journal. | **Implemented** | Native Menu contribution, carrier tests and Journal-backed configuration tests. Not descriptor configuration. |
| RUN-C03 | As a user, I can choose supported reasoning effort. | Host validates the declared values and commits the selection on submit. | **Implemented** | Provider validation, configuration tests, native Menu. Child default/override behavior is separate, not a claim of live inheritance refresh. |
| RUN-C04 | As a user, I can choose manual or auto approval. | Pending choice commits approval.policy.configured; policy reads current facts and auto creates no approval interaction. | **Implemented** | Tool policy and configuration tests; auto means approval, not review or sandbox. |
| RUN-C05 | As a user, I can choose a registered Assembly for a new Session. | Host resolves the actual code definition; Session records Assembly identity. | **Implemented** | Settings New Session uses the Host catalog for CASE1/CASE2; no immutable Generation or DSH preset parity. |
| RUN-C06 | As a user, I can change next-request configuration while idle. | Empty/existing Session follow the same pending→submit boundary; no runtime rebuild or load-time migration. | **Implemented** | Host PATCH configuration, carrier and restore tests; running Sessions cannot be reconfigured. |
| RUN-C07 | As a user, I can distinguish active and pending configuration. | Recorded Journal configuration is separate from the next submit choice; Assembly is not a code snapshot. | **Implemented** | Cover labels recorded/next configuration; input menus edit pending; no Generation promise. |
| RUN-C08 | As a local user, I can manage Providers without restarting. | Add/edit/test/delete/default returns only redacted summaries. | **Implemented** | DSH Settings, ProviderStore and HTTP tests; confirmed real test request, environment profiles read-only. |

### 4.4 Conversation and control

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-I01 | As a user, I can submit multiline input predictably. | Native input preferences/shortcuts preserve multiline and IME input. | **Implemented** | DSH native composer preferences; earlier Web uses Enter/Shift+Enter. Do not assume identical shortcuts across shells. |
| RUN-I02 | As a user, I can see streamed content, reasoning, tool arguments and Bash output. | Disposable channels reconcile to recorded facts without swallowing assistant content. | **Implemented** | Carrier stream/lifecycle tests; native cards plus temporary live Bash dock. |
| RUN-I03 | As a user, I do not lose assistant content when a generation also contains reasoning and tool calls. | Committed projection renders reasoning, assistant content and calls in semantic order. | **Implemented** | Journal/generation projection, live-execution and lifecycle tests; earlier real-session regression. |
| RUN-I04 | As a user, I can read formatted output. | Markdown renders while raw Journal stays inspectable. | **Implemented** | Official Chat renderer; earlier Web react-markdown/remark-gfm. |
| RUN-I05 | As a user, I can collapse large tool and reasoning content. | Native preparing/result/reasoning views remain inspectable. | **Implemented** | Official views and mapped card tests; no copied legacy card system. |
| RUN-I06 | As a user, I can answer Agent questions by option or free text. | Ask waits inside tool lifecycle; choices include an Other path; the answer returns as tool result. | **Implemented** | Ask tool/broker; interaction test; `Other…` at `2538068`. |
| RUN-I07 | As a user, I can resolve several pending interactions. | One displayed pending card; unresolved items replay and settled items retire. | **Partial** | Native selection, interaction broker and settlement/reconnect tests; no guaranteed FIFO or user-editable queue. |
| RUN-I08 | As a user, I can pause after the current complete event and resume safely. | Pause never interrupts a handler; resume continues at the first undelivered event. | **Implemented** | Controlled boundary and CASE2 pause test. |
| RUN-I09 | As a user, I can steer a running Agent. | New input is durably appended; stale completion is rejected; steering folds into a legal continuation. | **Implemented** | CASE2 steering tests; `submit()` routes running input to `steer()`. |
| RUN-I10 | As a user, I can queue follow-up after the current turn. | Follow-up is sent only after idle. | **Partial** | Earlier Web keeps one transient follow-up; DSH queue RPC is explicitly refused. No durable queue. |
| RUN-I11 | As a user, I can see current Todo/Goal. | Derive state from recorded results, never denied/intended calls. | **Implemented** | Native todos and read-only GoalBar; projectSessionFacts and business-projection tests. Goal edit/pause/clear absent. |
| RUN-I12 | As a user, I can delegate a bounded task to a persistent child Agent. | Child inherits workspace/policy by default, owns an independent Journal, and returns only a summary. | **Implemented** | `spawn_agent`; persistent child test and real 47-fact child. |
| RUN-I13 | As a user, I can inspect and control active children after spawning them. | List/status/message/wait/cancel operations are explicit and survive restore. | **Missing** | Current tool is synchronous one-shot spawn only; UI lists completed/live child Session. |
| RUN-I14 | As a user, I receive a useful error when the model/provider/handler fails. | Run error is visible, Session returns to a known state, and recoverable failures can continue without hidden replay. | **Partial** | `run.error` exists and tool exceptions become results; provider/handler retry and failure-resume policy are not complete. |
| RUN-I15 | As a user, I can reconnect to committed progress and unresolved interactions. | Snapshot/broker remain authoritative, without made-up stream prefixes. | **Partial** | Carrier reconnect and settlement tests; in-flight deltas/stdout missed while disconnected are not replayed. |

### 4.5 Agent-visible capabilities

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-A01 | As an Agent, I can inspect, create, replace, edit, and execute within a workspace. | read is bounded/resumable; write/edit results are compact; Bash streams; failures return to the model. | **Implemented** | CASE2 tools and tests; real 89 tool batches with no uncaught tool failure. |
| RUN-A02 | As an Agent, I receive stable workspace/project instructions. | CASE2 appends context.fixed once when absent, waits before first LLM request and reuses it after restore. | **Implemented** | workspace-context.ts, coding-flow.ts, CASE2/projection tests. Root AGENTS.md/CLAUDE.md are not automatically reloaded on change. |
| RUN-A03 | As an Agent, I can continue after semantic history compaction. | Threshold creates a checkpoint, selected history is summarized, and the pending request resumes. | **Implemented** | Compression plugin and CASE2 compaction test. Error-triggered compaction is absent. |
| RUN-A04 | As an Agent, I can explicitly search the Web. | Configured source/key and tool result are distinct from the generation Provider; sources remain attributable. | **Implemented** | Host assembles web_search when a DeepSeek search profile exists; optional KNOT_WEB_SEARCH_PROVIDER_PROFILE_ID; native search card tests. No configurable result budget yet. |
| RUN-A05 | As an Agent, I can receive ordered images/files and use a capable multimodal Provider. | Attachments are durable objects with admission limits and provider-neutral projection. | **Missing** | Text-only message contract. |
| RUN-A06 | As an Agent, I can discover and load conditional rules, skills, or dynamic tools. | Index is small/stable; selected detail is attributable and bounded. | **Missing** | Current native tool registry is fixed; root project instructions are automatically loaded, but general skills/dynamic discovery are absent. |

### 4.6 Inspection and delivery

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-D01 | As a user, I can inspect the raw authoritative Journal. | Events preserve file order and detached payloads; reading never runs handlers. | **Implemented** | JSONL reader, Journal panel, read-only tests. |
| RUN-D02 | As a user, I can inspect recorded timing and filter facts. | JSONL timestamps remain outside event data; absent timing is not invented. | **Implemented** | Native Trajectory and Journal filter; storage metadata. Owner labels do not prove handler execution. |
| RUN-D03 | As a user, I can inspect a historical model input. | Selected llm.invoke reconstructs canonical messages/tools, manifest, bounded source references and composition. | **Implemented** | Context Host endpoint, context-inspection.ts, context-projection/session-inspection tests and native tab; composition is characters, not per-segment tokens. |
| RUN-D04 | As a user, I can inspect plugin declarations and matched input facts. | Current executable metadata is labelled; observed facts are not equated to handler execution. | **Implemented** | analytics/plugins, plugin-analytics.ts and sibling Client tab/tests. Not historical code or exact handler provenance. |
| RUN-D05 | As a user, I can review applied file changes without flooding Chat. | Display is tied to measured before/after workspace state. | **Partial** | Native read/write/edit cards show page/intended edits; no applied full-file diff or separate changed-file sidebar. |
| RUN-D06 | As a user, I can open explicit final deliverables. | Agent declares files; Host validates; UI presents stable cards/open actions. | **Missing** | No deliverable protocol. |
| RUN-D07 | As a user, I can see context/generation metrics. | Usage/cache/window/end-to-end rate distinguish known from missing values. | **Implemented** | Shared session-facts, native Stats wrapper, cover/context/tool analytics; not monetary pricing or native decode TPS. |
| RUN-D08 | As a user, I can understand a Session before entering Chat. | Cover shows identity/configuration, metrics, Todo/Goal and original Query directory with semantic Chat links. | **Implemented** | S5 session-cover.ts, cover-client.tsx, HTTP/projection/native navigation tests; no generated summary or child rollup. |
| RUN-D09 | As a user, I can inspect unused as well as used tools. | Registry history includes zero-call/removed entries; share, explicit-result success, unknown/unfinished remain distinct. | **Implemented** | analytics/tools, tool-analytics.ts, session-inspection tests; batch wait is not per-handler duration. |

## 5. Studio mode stories

Studio currently retains a minimal Case/Run inspection surface in the earlier Web only.
Broader production/simulation/evaluation stories below are candidates, not committed work.

### 5.1 Project and Case authoring

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-P01 | As a developer, I can enter Studio without stopping Sessions. | Separate view leaves Host runtimes unchanged. | **Partial** | Earlier Web has Run/Studio switching; DSH has no Studio editor. |
| STU-P02 | As a developer, I can list persisted Cases for a Project. | Host scopes Cases by real Project identity. | **Implemented** | StudioController and earlier Web; not DSH. No immutable source version. |
| STU-P03 | As a developer, I can create a basic Case. | Host persists title, workspace, prompt and default event assertions. | **Partial** | Earlier Web/Host real; arbitrary fixtures and assertion editing absent. |
| STU-P04 | As a developer, I can clone a Case/Assembly before editing. | Independent artifact retains source lineage. | **Missing** | Stores exist, but clone/edit commands do not. |
| STU-P05 | As a developer, I can configure workspace and environmental fixtures. | Configuration is validated by the Host and reproducible on rerun. | **Partial** | Case workspace is persisted and used by Runs; environmental fixtures and editable workspace configuration are absent. |
| STU-P06 | As a developer, I can persist and version Project/Case source. | Clean checkout recovers executable definition and scenario. | **Partial** | Local studio.json stores Project/Case/Run references; Git versions TS, no portable Project source/artifact format. |

### 5.2 Assembly composition

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-A01 | As a developer, I can see actual plugin registration order/categories. | Read view derives from the current execution declaration. | **Implemented** | Shared CASE definitions, earlier Studio and DSH plugin tab; not pinned historical code. |
| STU-A02 | As a developer, I can inspect each plugin's responsibility and non-responsibilities. | Metadata names owner, version, source, responsibility, protocols and configuration. | **Partial** | Single-source nodes provide responsibility/protocol/source metadata; version, owner and non-responsibility fields are absent. |
| STU-A03 | As a developer, I can inspect declared protocols. | Names/listens/emits come from execution declarations; absent payload schemas are explicit. | **Partial** | Single-source definitions and contract tests; no full payload-schema catalog. |
| STU-A04 | As a developer, I can inspect expected interaction paths. | Declared possibilities are distinct from observed sequence. | **Partial** | Earlier Studio Flow uses declarations and real Run facts in lists; no interactive sequence canvas. |
| STU-A05 | As a developer, I can inspect an observed event-reaction graph. | Actual Journal links are separated from inferred producer/consumer declarations. | **Partial** | Host Run flow lists real events and declaration matches; no recorded handler ownership or graph layout. |
| STU-A06 | As a developer, I can edit plugin ordering and supported configuration in Web. | Edits share the executable source and do not mutate an active Session. | **Missing** | Source can be edited externally; no Web Assembly editor. |
| STU-A07 | As a developer, I can inspect plugin source or open its documentation. | Metadata resolves to local source/docs without exposing arbitrary Host paths remotely. | **Missing** | No source-location contract. |
| STU-A08 | As a developer, I can add a custom plugin through Studio. | Trusted source can be created, tested and added to actual Assembly. | **Missing** | Code-based plugins work; no real Web library/scaffolding capability. |
| STU-A09 | As a developer, I can identify invalid assemblies. | Duplicate identities and declaration/execution drift fail tests or definition construction. | **Partial** | defineAssembly and contract tests; independent Validation UI/Generation health model removed. |

### 5.3 Model, policy and context configuration

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-C01 | As a developer, I can select Mock or real content boundaries for a Case. | Selection changes the actual run assembly while every other boundary stays fixed. | **Implemented** | Studio runs the same CASE2 assembly with either deterministic Mock or selected real Provider. |
| STU-C02 | As a developer, I can select Provider/model/reasoning for a Case run. | Run record captures exact selection and validates supported combinations. | **Partial** | New Session supports all three; Studio Case configuration does not own them. |
| STU-C03 | As a developer, I can configure approval and sandbox policy. | Policy is explicit, testable and included in the run record. | **Missing** | New Session approval mode exists; no Studio Case policy surface or sandbox mode. |
| STU-C04 | As a developer, I can configure prompt sections. | Source changes use the actual prompt owner and can be tested. | **Partial** | Source-owned prompt inspect is real; no page editing, section budget or immutable Generation. |
| STU-C05 | As a developer, I can configure dynamic context strategy. | Lifetime/projection policy is explicit and comparable between runs. | **Missing** | Workspace context strategy is source code. |
| STU-C06 | As a developer, I can configure tool presentation. | Native/PTC/other modes preserve one tool semantics contract and are recorded per run. | **Missing** | Native Function Calling only. |
| STU-C07 | As a developer, I can configure compaction thresholds and policy. | Config is validated, visible and included in reproducibility evidence. | **Missing** | Runtime supports options; Workbench does not expose a compaction-policy editor. |

### 5.4 Case execution and evaluation

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-E01 | As a developer, I can execute a Case as a Session. | Run uses the selected Project Assembly/current code, input and workspace. | **Implemented** | StudioController and Host createRunSession; this is not historical executable restoration. |
| STU-E02 | As a developer, I can run deterministic Mock assertions. | Case provisions fixture, uses scripted provider/effects, evaluates Journal assertions, and stores result. | **Partial** | Deterministic Mock runs and Journal event assertions are real; workspace fixture provisioning is absent. |
| STU-E03 | As a developer, I can run a real-model experiment with the same boundaries. | Only declared boundary changes; outcome and metrics persist beside Mock run. | **Implemented** | Real and Mock Runs are grouped by Case and retain Provider/reasoning selections plus Journal-derived evidence. |
| STU-E04 | As a developer, I can compare two Runs side by side. | Align paths/inputs/outcomes/costs using controlled scenario boundaries. | **Missing** | Persisted Run records exist; controlled comparison UI/runtime absent. |
| STU-E05 | As a developer, I can view assertion failures with provenance. | Failure links to expected rule, actual fact/path and owning plugin/context source. | **Partial** | Event-presence assertion results are stored, but failures do not link to event/plugin provenance. |
| STU-E06 | As a developer, I can repeat a Case and group results. | Runs retain Case id, execution mode, Session and selected Provider/effort. | **Implemented** | Current Studio Run records; no immutable Case/code snapshot. |
| STU-E07 | As a developer, I can see real eval metrics. | Duration, requests, tools, input/cache/output/reasoning tokens and success derive from stored run evidence. | **Partial** | Event/model/tool/token/duration metrics derive from Journal; cache and reasoning token breakdown are absent. |

### 5.5 Activation and export

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-X01 | As a developer, I can publish an immutable executable Assembly. | Artifact pins source/dependencies/configuration and can restore that runtime. | **Deferred** | Original declaration-only Generation/Publish removed; no artifact packaging. |
| STU-X02 | As a developer, I can activate a published version. | New/old Sessions resolve their chosen executable artifact. | **Deferred** | No Generation activation; current sessions resolve registered code definitions. |
| STU-X03 | As a developer, I can replace Assembly at an idle boundary. | Compatibility/recovery semantics are demonstrated with real versions. | **Deferred** | No active-Session topology replacement; model/approval configuration is a different, implemented concern. |
| STU-X04 | As a developer, I can hot-insert a semantic plugin during an active turn. | Event cursor, in-flight request, schema and teardown semantics are deterministic. | **Deferred** | Explicitly excluded; no observed requirement justifies this complexity. |
| STU-X05 | As a developer, I can export a validated Agent. | Exported CLI/service uses the same verified plugins/projections. | **Deferred** | No deployable artifact/export contract; a compiled source checkout is not a Studio export. |

## 6. Cross-cutting product stories

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| CROSS-01 | As a user, I can switch all product-owned UI between Chinese and English. | Static labels/errors/accessibility are localized, machine/model content unchanged. | **Partial** | Earlier Web catalogs and native DSH locale exist; custom Knot Client labels still partly hardcoded. |
| CROSS-02 | As a maintainer, protocol/event identifiers remain language-neutral. | Locale never changes Journal event types, DTO fields, tool names or durable machine contracts. | **Implemented** | Existing contracts use stable English identifiers. |
| CROSS-03 | As a user, Host errors appear in my locale without losing stable error identity. | Host returns code + parameters; Web localizes presentation; logs retain canonical diagnostics. | **Partial** | Host has error codes but often sends final English prose; Web displays message directly. |
| CROSS-04 | As a plugin author, I can supply localized metadata. | Canonical identity has optional localized descriptions. | **Deferred** | Real metadata is source-owned and English-only; no locale-map requirement established. |
| CROSS-05 | As a keyboard user, I can operate primary Run and Studio paths. | Focus order, visible focus, labels, shortcuts and dialogs are testable. | **Partial** | Focus styles and labels exist; no complete keyboard/accessibility audit. |
| CROSS-06 | As a user, desktop layout remains usable. | Native/custom panels and composer stay reachable at supported widths. | **Partial** | Native shell and earlier Web layout exist; no exhaustive wide/narrow/keyboard regression matrix. |
| CROSS-07 | As an operator, browser clients cannot access credentials or arbitrary Host files. | Credentials stay server-side; file/Journals are selected by Host configuration/Session identity. | **Partial** | Provider credentials are server-side and read paths are bounded; authentication/network deployment is intentionally absent for localhost. |
| CROSS-08 | As a maintainer, Fixtures never masquerade as runtime truth. | Real mode has no fixture fallback; absent facts are unknown/disabled. | **Implemented** | Explicit mode, refusing carrier, real read projections and production-build checks; fixture-only capabilities are not advertised as connected. |
| CROSS-09 | As a maintainer, product telemetry and external sharing are opt-in and separable. | Local runtime works with no external collection; any future sharing has explicit policy/redaction. | **Deferred** | Current product is local-only and sends no Workbench telemetry. |
| CROSS-10 | As a maintainer, Run and Studio changes do not modify `src/journal.ts` without case evidence. | Kernel-change review gate and existing tests remain green. | **Implemented** | Product plan rule; all current Workbench features use Host ports/platform plugins. |

## 7. Internationalization boundary

Internationalization belongs to the Web product and optional metadata presentation, not to Journal
semantics.

```text
locale preference
       |
       v
Web message catalog ----> navigation / dialogs / status / accessibility
       |
       +---------------> errorCode + params -> localized error

Journal event types, tool names, DTO fields, model output and user content
remain unchanged and are never translated implicitly.
```

Boundary for remaining localization work (not an implementation approval):

1. `en` and `zh-CN` catalogs owned by Web.
2. Browser preference as initial default and a visible settings switch.
3. Preference stored locally; no Host account setting is required initially.
4. Host responses keep stable error codes and progressively replace final prose with parameters.
5. Plugin metadata later supports a canonical value plus optional locale map or documentation links.
6. Model/user conversation content is rendered verbatim.

## 8. Industry reference rubric

Codex, Claude Code and Cursor are product-behavior references, not requirements sources. Compare
observable workflows rather than copying internal mechanisms.

| Area | Behaviors to compare |
|---|---|
| Session | create/resume, branch/fork, archive, task lineage, workspace isolation |
| Control | steering, queued follow-up, graceful stop, permission presets, questions |
| Context | usage breakdown, compaction, rules/skills, file references, model switching |
| Coding | bounded file reads, diff presentation, terminal lifecycle, test feedback |
| Delegation | child visibility, model selection, workspace policy, approval routing |
| Delivery | changed files, citations, artifacts, final summary, open-in-editor behavior |
| Diagnostics | trace visibility, errors, retry, request/tool timing, token/cache metrics |

An industry product may solve a concern in a product-specific way. Knot should adopt the user value
only when it fits the Journal-first runtime and has a reproducible acceptance trajectory.

## 9. Review conclusions

1. Run is ready for sustained CASE2 use. Fix observed product/runtime/business problems rather
   than treating feature parity as a prerequisite.
2. DSH native presentation and Knot execution semantics stay separate. Prefer native slots where
   equivalent; unsupported capability mutations are hidden/refused, not simulated.
3. Studio remains an earlier-Web Case/Run tool. Generation, publication, visual composition,
   controlled comparison, Dataset Eval and dynamic plugins are not current capabilities.
4. Input reconstruction, approximate subscription counts and unknown usage must be stated
   precisely. Historical artifacts and external-effect replay are not proven by a JSONL alone.
5. This ledger inventories options, not implementation authority. See the current
   [product model](workbench-product-model.md) and [DSH integration guide](../../web-dsh-reference/README.md).
