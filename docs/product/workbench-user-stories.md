# Knot Workbench product user stories

Status: product capability ledger for review, not a frozen public contract

Baseline: `8df9514` (`main`, 2026-09-20)

Scope: the two primary product surfaces, **Run** and **Studio**

Next implementation phase: deliberately undecided; this document inventories before it schedules

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

Completion indicators use `Implemented = 1`, `Partial = 0.5`, `Fixture = 0.25`, and
`Missing/Deferred = 0`. They are navigation aids, not quality scores. A small but critical story can
matter more than several cosmetic ones.

Evidence abbreviations:

- **Web:** `web/src/App.tsx`, `web/src/journal-api.ts`, `web/src/styles.css`
- **HTTP:** `src/workbench/http-server.ts`
- **Session:** `src/workbench/session.ts`, `src/workbench/live-session.ts`
- **Host:** `src/workbench/run.ts`
- **CASE2:** `src/cases/case2/`
- **WB tests:** `test/workbench.test.ts`, `test/workbench-live.test.ts`
- **CASE2 tests:** `test/case2.test.ts`
- **Real run:** persisted `CASE2 coding task run`, 514 Journal facts; persistent child Session, 47 facts

## 3. Completion view

### 3.1 Current product view

| Surface | Implemented | Partial | Fixture | Missing | Deferred | Indicator |
|---|---:|---:|---:|---:|---:|---:|
| Run | 26 | 9 | 4 | 12 | 1 | 61% |
| Studio | 4 | 14 | 1 | 13 | 2 | 33% |
| Cross-cutting product concerns | 4 | 4 | 1 | 0 | 1 | 63% |

### 3.2 Interpretation

- The **daily Run loop** is already usable: create/select a Session, choose a configured model,
  submit work, stream progress, approve effects, answer questions, inspect tools, resume persisted
  Sessions, and open child Sessions.
- The broader planned **Run product** is incomplete mainly around file/diff delivery, Session
  lifecycle operations, branching, attachments, search, and configurable Provider profiles.
- **Studio now has one real CASE2 vertical slice:** persisted Cases, static Assembly checks,
  Mock/real Runs, Journal-derived metrics, and declaration-fingerprinted Generation identities.
  Assembly metadata is still maintained separately from executable composition, and Generations
  do not yet preserve executable code artifacts.
- The percentages must not trigger automatic implementation. The next planned work remains a
  separate decision after review.

## 4. Run mode stories

### 4.1 Project and workspace

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-P01 | As a user, I can see the active project and absolute workspace for the selected Session. | Header and status strip show the selected Session workspace; it changes when the Session changes. | **Implemented** | `SessionSummaryDto.workspace`; `WorkbenchHeader`; `RunView`. |
| RUN-P02 | As a user, I can switch between saved projects. | Project selection changes the project-scoped Session/case inventory and persists across reload. | **Fixture** | `initialProjects` is browser-local; selecting it does not change the Host registry. |
| RUN-P03 | As a user, I can create a project rooted at a workspace. | Project metadata is validated, stored, restored, and scopes later cases and Sessions. | **Fixture** | Dialog mutates React state only. No Host project contract/store exists. |
| RUN-P04 | As a user, I can choose a local workspace without manually typing a path. | A desktop/host-mediated directory picker returns a Host-valid path without browser path spoofing. | **Deferred** | Ordinary browser directory APIs do not disclose a portable absolute Host path. Requires a desktop/Host picker boundary. |
| RUN-P05 | As a user, I can see real repository branch and working-tree state. | Branch/status are derived from the selected workspace and update after tools change it. | **Partial** | Workspace is real; `main` is currently presentation text, not repository observation. |
| RUN-P06 | As an operator, I can prevent an Agent from silently escaping its assigned workspace through coding file tools. | read/write/edit reject paths outside the workspace and report a model-visible failure. | **Implemented** | `workspacePath()` in `coding-tools.ts`; CASE2 tests. Bash remains intentionally policy-controlled rather than path-rewritten. |

### 4.2 Session lifecycle

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-S01 | As a user, I can list and switch Sessions without stopping them. | Sidebar reflects registry changes; selecting one loads its snapshot and live stream. | **Implemented** | Catalog GET/SSE, `SessionRegistry`, `ProjectRail`; real parent/child run. |
| RUN-S02 | As a user, I can create a Session with title, workspace, provider, reasoning effort, and approval mode. | Host validates options, creates JSONL-backed runtime, saves its descriptor, and returns it in the catalog. | **Implemented** | New-session dialog; `POST /sessions`; `newLiveSession`; descriptor test. |
| RUN-S03 | As a user, I can continue a completed idle Session after Host restart. | Descriptor and JSONL restore; a new message produces a distinct turn without replaying old handlers. | **Implemented** | `loadSessionDescriptors`; host reconstruction test; CASE2 JSONL restore test. |
| RUN-S04 | As a user, I can run multiple Sessions concurrently without state crossing. | Workspace, Journal, live events, interactions, and run state remain isolated. | **Implemented** | `two live sessions run concurrently...` WB test. |
| RUN-S05 | As a user, I can see parent/child Session relationships and open a child trace. | Child is persisted with `parentSessionId`, shown under its parent, and independently selectable. | **Partial** | Identity, indentation and independent Journal are real; there is no collapsible tree, outcome badge, or navigation back-reference. |
| RUN-S06 | As a user, I can rename a Session. | Rename persists and updates every open catalog subscriber. | **Missing** | Title is descriptor-owned but no update command exists. |
| RUN-S07 | As a user, I can archive or remove an obsolete Session. | The action is explicit, recoverability is stated, and catalog/session artifacts are handled consistently. | **Missing** | No lifecycle command beyond create. |
| RUN-S08 | As a user, I can fork a Session at its current head. | A new Session receives a causally valid seed and independent future Journal while retaining lineage. | **Missing** | `parentSessionId` currently means subagent ownership, not history lineage. |
| RUN-S09 | As a user, I can explore an earlier event without mutating the append-only source. | Selecting an event creates a branch/fork from that boundary; original JSONL remains unchanged. | **Missing** | Intended replacement for destructive rewind. Requires a seed/projection boundary. |
| RUN-S10 | As a user, I can export or import a Session for diagnosis. | Export has a documented portable envelope and import never executes old events as handlers. | **Missing** | Raw JSONL can be copied manually; no product contract. |

### 4.3 Agent configuration

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-C01 | As a user, I can see configured Provider profiles without exposing credentials. | Browser receives id/label/adapter/model/configured state only. | **Implemented** | `ProviderProfileSummary`; provider-profile tests. |
| RUN-C02 | As a user, I can choose the model/provider for a new Session. | Selection maps to one server-side Provider factory and is persisted in the descriptor. | **Implemented** | Provider endpoint, new-session dialog, `profileForDescriptor`. |
| RUN-C03 | As a user, I can choose supported reasoning effort for a new Session. | UI shows only declared values; Host rejects unsupported selections; child inherits unless overridden. | **Implemented** | `ReasoningEffort`; Provider profile validation; persistent subagent real run. |
| RUN-C04 | As a user, I can choose ask or automatic tool approval. | The selected policy is assembly-owned and persists across restart; auto mode creates no approval interaction. | **Implemented** | `ApprovalMode`; CASE2 assembly policy; auto-approval test. |
| RUN-C05 | As a user, I can choose a Case/Assembly/Preset for a new Session. | Selection resolves a healthy immutable assembly generation and is recorded with the Session. | **Partial** | Descriptor records `assembly`, but Host creation is hard-wired to CASE2. Studio case selection does not select a real assembly. |
| RUN-C06 | As a user, I can change configuration on an empty Session safely. | Change is persisted before any model-visible content and rebuilds the runtime deterministically. | **Missing** | New Session options work only at creation. |
| RUN-C07 | As a user, I understand which configuration is pinned for this Session. | Header/settings show provider, model, reasoning, approval, assembly id and generation. | **Partial** | Model and workspace are visible; other settings require inference, and the recorded Generation identity does not yet pin an executable artifact. |
| RUN-C08 | As a local user, I can add a Provider profile without restarting or editing environment variables. | Host validates and persists adapter/base URL/model/key; browser receives only a redacted summary; a new Session can use it immediately. | **Implemented** | Local `0600` Provider store, redacted GET/POST API, settings form, restart and HTTP tests. Editing/deletion remain absent. |

### 4.4 Conversation and control

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-I01 | As a user, I can submit multiline input predictably. | Enter sends, Shift+Enter inserts a line break, and IME composition does not send prematurely. | **Implemented** | Composer key handling at `2538068`. |
| RUN-I02 | As a user, I can see content, reasoning, tool-call arguments, and Bash output while they stream. | Each channel is distinct and transient; completion reconciles to durable Journal facts. | **Implemented** | LiveOutput/ToolOutput ports, SSE, Web live drafts, streaming tests. |
| RUN-I03 | As a user, I do not lose assistant content when a generation also contains reasoning and tool calls. | Committed projection renders reasoning, assistant content and calls in semantic order. | **Implemented** | `tool.call.assistantContent` rendering; real 514-fact regression. |
| RUN-I04 | As a user, I can read formatted final output. | GFM Markdown renders while raw Journal payload remains inert text. | **Implemented** | `react-markdown` + `remark-gfm`. |
| RUN-I05 | As a user, I can collapse tool calls, tool results, and reasoning. | Large payloads default to a controlled presentation and remain inspectable. | **Implemented** | `<details>` tool/reasoning cards and output height caps. |
| RUN-I06 | As a user, I can answer Agent questions by option or free text. | Ask waits inside tool lifecycle; choices include an Other path; the answer returns as tool result. | **Implemented** | Ask tool/broker; interaction test; `Other…` at `2538068`. |
| RUN-I07 | As a user, I can resolve several pending approvals/questions in a deterministic queue. | One active interaction is shown with queue size and pending items survive reconnect. | **Partial** | Broker replays unresolved interactions and UI shows `N waiting`; user cannot inspect/reorder the full queue. |
| RUN-I08 | As a user, I can pause after the current complete event and resume safely. | Pause never interrupts a handler; resume continues at the first undelivered event. | **Implemented** | Controlled boundary and CASE2 pause test. |
| RUN-I09 | As a user, I can steer a running Agent. | New input is durably appended; stale completion is rejected; steering folds into a legal continuation. | **Implemented** | CASE2 steering tests; `submit()` routes running input to `steer()`. |
| RUN-I10 | As a user, I can queue a follow-up for after the current turn. | Follow-up survives ordinary UI rerender and is sent only when the Session becomes idle. | **Partial** | Browser state supports one queued follow-up; it is not durable across page reload/Host restart. |
| RUN-I11 | As a user, I can see current Todo and Goal state. | UI folds the latest tool state and displays completion without adding presentation events. | **Implemented** | `todosFrom`, `goalFrom`; real 9-item Todo run. |
| RUN-I12 | As a user, I can delegate a bounded task to a persistent child Agent. | Child inherits workspace/policy by default, owns an independent Journal, and returns only a summary. | **Implemented** | `spawn_agent`; persistent child test and real 47-fact child. |
| RUN-I13 | As a user, I can inspect and control active children after spawning them. | List/status/message/wait/cancel operations are explicit and survive restore. | **Missing** | Current tool is synchronous one-shot spawn only; UI lists completed/live child Session. |
| RUN-I14 | As a user, I receive a useful error when the model/provider/handler fails. | Run error is visible, Session returns to a known state, and recoverable failures can continue without hidden replay. | **Partial** | `run.error` exists and tool exceptions become results; provider/handler retry and failure-resume policy are not complete. |
| RUN-I15 | As a user, I can reconnect without losing unresolved interactions or committed progress. | Snapshot is authoritative, EventSource reconnects, and pending asks/approvals replay. | **Partial** | Journal and pending interaction replay are real; transient generation/output during disconnect is not replayed. |

### 4.5 Agent-visible capabilities

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-A01 | As an Agent, I can inspect, create, replace, edit, and execute within a workspace. | read is bounded/resumable; write/edit results are compact; Bash streams; failures return to the model. | **Implemented** | CASE2 tools and tests; real 89 tool batches with no uncaught tool failure. |
| RUN-A02 | As an Agent, I receive stable system instructions and a current-turn workspace context. | System prompt is installed once; current dynamic context remains stable through the whole tool loop. | **Implemented** | `system-prompt.ts`, `workspace-context.ts`, projection tests. This is functional, not yet optimized. |
| RUN-A03 | As an Agent, I can continue after semantic history compaction. | Threshold creates a checkpoint, selected history is summarized, and the pending request resumes. | **Implemented** | Compression plugin and CASE2 compaction test. Error-triggered compaction is absent. |
| RUN-A04 | As an Agent, I can search the Web through an explicit governed capability. | Search source, credentials, result budget, citations, and policy are declared. | **Missing** | Bash network access is not an equivalent product contract. |
| RUN-A05 | As an Agent, I can receive ordered images/files and use a capable multimodal Provider. | Attachments are durable objects with admission limits and provider-neutral projection. | **Missing** | Text-only message contract. |
| RUN-A06 | As an Agent, I can discover and load conditional rules, skills, or dynamic tools. | Index is small/stable; selected detail is attributable and bounded. | **Missing** | Current tool registry is fixed and fully presented. |

### 4.6 Inspection and delivery

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| RUN-D01 | As a user, I can inspect the raw authoritative Journal. | Events preserve file order and detached payloads; reading never runs handlers. | **Implemented** | JSONL reader, Journal panel, read-only tests. |
| RUN-D02 | As a user, I can inspect event timing and filter the trajectory. | Timestamp/elapsed metadata remain outside Journal data and can be searched by event/owner/payload. | **Implemented** | JSONL storage metadata; Trace panel. Owner labels are currently a Web mapping. |
| RUN-D03 | As a user, I can inspect the exact canonical context for a selected model invocation. | Selected `llm.invoke` reconstructs messages, tools, provenance, token contribution, and checkpoint boundaries on demand. | **Fixture** | Context tab uses `contextMessages`; no real per-invocation endpoint. |
| RUN-D04 | As a user, I can inspect the actual assembly and plugin activity for this Session. | Inventory comes from the pinned assembly generation and distinguishes declared from observed behavior. | **Fixture** | Plugins tab uses static fixtures. |
| RUN-D05 | As a user, I can preview changed files and review diffs without flooding the conversation. | File/diff presentation is separate from raw tool arguments/results and tied to workspace state. | **Missing** | Current write/edit calls show collapsible JSON only. |
| RUN-D06 | As a user, I can open explicit final deliverables. | Agent declares files; Host validates; UI presents stable cards/open actions. | **Missing** | No deliverable protocol. |
| RUN-D07 | As a user, I can see useful context and generation metrics. | Last-request input/output/window/rate are visible and missing usage is shown as unknown. | **Partial** | Current strip shows last usage/rate; no cumulative cost, cache tokens, source breakdown, or reasoning ratio. |

## 5. Studio mode stories

Studio is an Agent production, simulation, and evaluation surface. It is not intended to become a
generic visual programming language.

### 5.1 Project and Case authoring

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-P01 | As a developer, I can enter Studio without disturbing a running Session. | Run and Studio are independent views over the same selected project. | **Implemented** | Run/Studio mode switch. |
| STU-P02 | As a developer, I can list saved Cases for a project. | Cases come from a persistent project source with identity, version and health. | **Partial** | Host persists CASE2 Cases in `studio.json`; Project scoping, source version and health are absent. |
| STU-P03 | As a developer, I can create a Case from a template. | The Case is stored with assembly, fixture, inputs, assertions and environment assumptions. | **Partial** | New Case persists title plus CASE2 defaults; template, fixture and assertion editing are absent. |
| STU-P04 | As a developer, I can clone an existing Case/Assembly before editing it. | Clone produces an independent editable artifact and preserves source lineage. | **Missing** | No project or Case store. |
| STU-P05 | As a developer, I can configure workspace and environmental fixtures. | Configuration is validated by the Host and reproducible on rerun. | **Partial** | Case workspace is persisted and used by Runs; environmental fixtures and editable workspace configuration are absent. |
| STU-P06 | As a developer, I can persist and version Project/Case source. | Clean checkout can reconstruct the same Case and its assembly generation. | **Partial** | Local Studio state persists Cases and Run records, but no checked-in Project/Case source contract exists. |

### 5.2 Assembly composition

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-A01 | As a developer, I can see plugin registration order and categories. | View reflects the selected real assembly generation, not a global fixture. | **Partial** | CASE2 executable nodes and Studio share one registration source; immutable executable Generation restoration is still absent. |
| STU-A02 | As a developer, I can inspect each plugin's responsibility and non-responsibilities. | Metadata names owner, version, source, responsibility, protocols and configuration. | **Partial** | Single-source nodes provide responsibility/protocol/source metadata; version, owner and non-responsibility fields are absent. |
| STU-A03 | As a developer, I can inspect declared event protocols. | Producer, consumers and fields resolve from real protocol/assembly metadata. | **Partial** | Declared event names come from the executable node definitions; payload schemas remain absent. |
| STU-A04 | As a developer, I can inspect the expected interaction sequence. | Sequence is tied to a Case/version and can distinguish expected from observed. | **Fixture** | Static CASE2 sequence. |
| STU-A05 | As a developer, I can inspect an observed event-reaction graph from a run. | Graph is derived from Journal plus assembly registration evidence and links to concrete events. | **Missing** | Trace has inferred owner labels but no subscriber/production graph. |
| STU-A06 | As a developer, I can edit plugin ordering and supported configuration. | Editor uses declared schemas, validates before activation, and never mutates a running generation. | **Missing** | No assembly source/editor. |
| STU-A07 | As a developer, I can inspect plugin source or open its documentation. | Metadata resolves to local source/docs without exposing arbitrary Host paths remotely. | **Missing** | No source-location contract. |
| STU-A08 | As a developer, I can add or develop a custom plugin. | A trusted local source is scaffolded, validated, tested and added to a new generation. | **Missing** | Plugin library dialog is descriptive only. |
| STU-A09 | As a developer, I can see broken assemblies and actionable reasons. | Discovery distinguishes healthy/broken generations and creation fails atomically. | **Missing** | CASE2 is compiled directly; there is no assembly catalog/discovery health. |

### 5.3 Model, policy and context configuration

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-C01 | As a developer, I can select Mock or real content boundaries for a Case. | Selection changes the actual run assembly while every other boundary stays fixed. | **Implemented** | Studio runs the same CASE2 assembly with either deterministic Mock or selected real Provider. |
| STU-C02 | As a developer, I can select Provider/model/reasoning for a Case run. | Run record captures exact selection and validates supported combinations. | **Partial** | New Session supports all three; Studio Case configuration does not own them. |
| STU-C03 | As a developer, I can configure approval and sandbox policy. | Policy is explicit, testable and included in the run record. | **Missing** | New Session approval mode exists; no Studio Case policy surface or sandbox mode. |
| STU-C04 | As a developer, I can configure system prompt sections. | Ordered sections identify source and stable/cache impact; changes create a generation. | **Missing** | CASE2 prompt is source code. |
| STU-C05 | As a developer, I can configure dynamic context strategy. | Lifetime/projection policy is explicit and comparable between runs. | **Missing** | Workspace context strategy is source code. |
| STU-C06 | As a developer, I can configure tool presentation. | Native/PTC/other modes preserve one tool semantics contract and are recorded per run. | **Missing** | Native Function Calling only. |
| STU-C07 | As a developer, I can configure compaction thresholds and policy. | Config is validated, visible and included in reproducibility evidence. | **Missing** | Runtime supports options; Workbench assembly does not expose them. |

### 5.4 Case execution and evaluation

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-E01 | As a developer, I can run the selected Case as a real Session. | Run creates a Session using the Case's actual assembly/config/fixture. | **Partial** | Real CASE2 Session uses persisted workspace/prompt/generation identity; richer fixtures and truly versioned executable Assembly are absent. |
| STU-E02 | As a developer, I can run deterministic Mock assertions. | Case provisions fixture, uses scripted provider/effects, evaluates Journal assertions, and stores result. | **Partial** | Deterministic Mock runs and Journal event assertions are real; workspace fixture provisioning is absent. |
| STU-E03 | As a developer, I can run a real-model experiment with the same boundaries. | Only declared boundary changes; outcome and metrics persist beside Mock run. | **Implemented** | Real and Mock Runs are grouped by Case and retain Provider/reasoning selections plus Journal-derived evidence. |
| STU-E04 | As a developer, I can compare two runs side by side. | Journal path, projected context, outcome, tokens, latency, model calls and tool calls align by Case steps. | **Missing** | No run-result model. |
| STU-E05 | As a developer, I can view assertion failures with provenance. | Failure links to expected rule, actual fact/path and owning plugin/context source. | **Partial** | Event-presence assertion results are stored, but failures do not link to event/plugin provenance. |
| STU-E06 | As a developer, I can repeat a Case and group results. | Runs share immutable Case/generation identity and record nondeterministic dimensions. | **Implemented** | Repeated Runs are grouped by Case and record mode, generation, Provider and reasoning selection. |
| STU-E07 | As a developer, I can see real eval metrics. | Duration, requests, tools, input/cache/output/reasoning tokens and success derive from stored run evidence. | **Partial** | Event/model/tool/token/duration metrics derive from Journal; cache and reasoning token breakdown are absent. |

### 5.5 Activation and export

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| STU-X01 | As a developer, I can save edits as an immutable assembly generation. | Generation has identity, source stamp, validation result and compatibility metadata. | **Partial** | Generation persists identity, declaration fingerprint and validation; no executable source snapshot or compatibility metadata. |
| STU-X02 | As a developer, I can activate a validated generation for new Sessions. | New Sessions use latest active generation; existing Sessions remain pinned. | **Partial** | New Sessions record the active identity, but runtime still constructs current CASE2 code rather than restoring a pinned executable artifact. |
| STU-X03 | As a developer, I can apply a compatible generation at an idle Session boundary. | Host unloads/rebuilds only after compatibility validation; Journal remains unchanged. | **Deferred** | Requires at least two real generations and migration evidence. |
| STU-X04 | As a developer, I can hot-insert a semantic plugin during an active turn. | Event cursor, in-flight request, schema and teardown semantics are deterministic. | **Deferred** | Explicitly excluded; no observed requirement justifies this complexity. |
| STU-X05 | As a developer, I can export a validated Agent. | Exported CLI/service uses the same plugins/projections verified in Studio. | **Missing** | Product plan Phase 6. |

## 6. Cross-cutting product stories

| ID | User story | Acceptance criteria | Status | Evidence / gap |
|---|---|---|---|---|
| CROSS-01 | As a user, I can switch the Workbench UI between Chinese and English. | Locale control updates all Web-owned navigation, dialogs, errors, labels and accessibility text and persists preference. | **Implemented** | Typed `en`/`zh-CN` catalogs, visible switch and local preference are wired across Run and Studio. |
| CROSS-02 | As a maintainer, protocol/event identifiers remain language-neutral. | Locale never changes Journal event types, DTO fields, tool names or durable machine contracts. | **Implemented** | Existing contracts use stable English identifiers. |
| CROSS-03 | As a user, Host errors appear in my locale without losing stable error identity. | Host returns code + parameters; Web localizes presentation; logs retain canonical diagnostics. | **Partial** | Host has error codes but often sends final English prose; Web displays message directly. |
| CROSS-04 | As a plugin author, metadata can be understandable in both languages. | Stable identity is separate from optional localized display name/description/documentation. | **Fixture** | Sample metadata is English-only browser fixture; runtime metadata is absent. |
| CROSS-05 | As a keyboard user, I can operate primary Run and Studio paths. | Focus order, visible focus, labels, shortcuts and dialogs are testable. | **Partial** | Focus styles and labels exist; no complete keyboard/accessibility audit. |
| CROSS-06 | As a user, layout remains usable at supported desktop widths. | Inspector can close/resize; central conversation and composer remain reachable. | **Implemented** | Responsive CSS, resizer and close control. |
| CROSS-07 | As an operator, browser clients cannot access credentials or arbitrary Host files. | Credentials stay server-side; file/Journals are selected by Host configuration/Session identity. | **Partial** | Provider credentials are server-side and read paths are bounded; authentication/network deployment is intentionally absent for localhost. |
| CROSS-08 | As a maintainer, fixture data is never presented as observed runtime truth. | Every fixture surface is marked or disabled beside real sessions. | **Partial** | Studio and some Inspector text says fixture; Plugins/Context can still visually resemble real Session evidence. |
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

Recommended first slice:

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

1. Run has crossed the usable-Agent threshold; its remaining stories should be prioritized by real
   usage, not by parity pressure.
2. Studio has a credible information architecture but is not yet a real project/case/assembly
   product. Its fixture status must remain explicit.
3. The most important product-layer contract to define next is an immutable Case/Assembly generation
   for **new** Sessions, not arbitrary active-turn hot insertion.
4. Internationalization can be added without affecting Journal or business plugins if stable Host
   error identity is kept separate from presentation text.
5. This inventory does not authorize implementation. The next review chooses a small subset after
   the business-plugin Context Lab design is understood.
