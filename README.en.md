# Knot

**A Journal-first agent runtime and workbench.**

[中文](README.md) · [Core concepts](docs/concepts.md) · [Plugin practices](docs/plugin-best-practices.md)

Humans, models, tools, and software plugins tie facts into one append-only Journal. A plugin reacts to facts that already happened and either appends another fact or stays silent. Their assembly becomes the agent, instead of concentrating every concern in a growing AgentLoop.

> Knot is alpha software. CASE1, CASE2, and Web Run using the official DSH shell are executable today. Assembly authoring, Case/Eval, and export formats are not frozen public contracts. Real use takes priority over full DSH feature parity.

![Knot Workbench showing a CASE2 conversation and its Journal inspector](docs/assets/knot-workbench.png)

This image is retained as evidence of the earlier custom Web. See [Workbench](#workbench) and the [integration guide](web-dsh-reference/README.md) for the current DSH shell.

## One model

```mermaid
flowchart LR
  H[Human]
  M[Model]
  T[Tools / Environment]
  P[Software Plugins]
  J[(Append-only Journal)]

  H -->|append facts| J
  M -->|append content / tool calls| J
  T -->|append observations| J
  P -->|append derived facts| J

  J -->|project / subscribe| H
  J -->|project context| M
  J -->|trigger effects| T
  J -->|event reactions| P
```

```text
Journal → Projection → Reaction → Effect → Journal
```

- The **Journal** is the authoritative append-only sequence of business facts.
- A **Projection** derives model context, UI, todo state, or metrics without creating another source of truth.
- A **Reaction** subscribes to events and decides whether to append another fact.
- An **Effect** interacts with a model, tool, filesystem, user, or environment and records the completed observation.
- An **Assembly** selects plugins and registration order, producing one concrete agent.

The kernel has no privileged business AgentLoop. Loops may exist, but they emerge from assembled event reactions and stop naturally when no reaction appends another event.

## Why

Complex agent harnesses tend to accumulate prompting, context, tools, permissions, retries, state machines, and UI behavior inside one control loop. The features work, but every change requires understanding the whole system, and failures become difficult to attribute.

Knot organizes the problem differently:

1. Completed business facts enter the Journal.
2. Each plugin owns one explainable reaction or effect boundary.
3. Plugins do not call other plugin implementations; they collaborate through event protocols.
4. Assembly owns semantic relationships, registration order, and completeness.
5. Tests replace providers, tools, or output plugins through assembly.

Observability, testability, replaceability, and local reasoning follow from that model. They are not extra kernel subsystems.

## The entire kernel

[`src/journal.ts`](src/journal.ts) is currently 56 lines, imports nothing, and knows nothing about models, tools, prompts, sessions, storage, trace, or UI.

```ts
type Event = { readonly type: string; readonly data: unknown }
type Handler = (event: Event) => void | Promise<void>
type Plugin = (journal: Journal) => void

interface Journal {
  append(type: string, data: unknown): Event
  read(): readonly Event[]
  subscribe(type: string, handler: Handler): void
}
```

Its current guarantees are append-only facts, at-most-once invocation of each matching subscriber during a normal drain, breadth-first Journal order, serial registration order for subscribers of one event, legal zero-subscriber events, unchanged error propagation, and non-reentrant `runUntilIdle`. A thrown handler aborts that drain immediately; the kernel neither fills missed deliveries nor retries them.

CASE1 and CASE2 use the same kernel without business-specific privileges. See [Core concepts](docs/concepts.md) for the complete model.

## How an agent emerges

A typical CASE1 tool trajectory is shown below. CASE2 requests the LLM directly, without content-source arbitration:

```text
user.message
  → context.dynamic
  → content.request
  → llm.request
  → llm.generated
  → tool.call
  → tool.result
  → llm.request
  → assistant.message
```

These arrows are not a built-in workflow. Each step comes from a plugin subscription and its produced facts. Rules, small models, or static sources may replace an LLM as a content source; the model is not the only content-producing role.

Plugins have no direct implementation dependencies, but business preconditions still exist. A `tool.call` needs an executor and an `llm.request` needs a provider. Protocols express relationships; Assembly is responsible for composing a set that works.

## Executable evidence

CASE1 and CASE2 exercise the same kernel from opposite directions. CASE1 is a
high-frequency, short-context agent with a constrained action space. CASE2 is a
long-horizon agent operating in an open environment through many tool calls.
Neither receives a business-specific privilege from the 56-line Journal.

| Case | Real scenario | What it exercises | Result |
|---|---|---|---|
| **CASE1** | Terminal-control assistant driving a USB-connected phone | dynamic tool context, one Bash entry point, a business CLI, pending candidate state, Mock/ADB dispatchers | 66 consecutive requests covered 56 CLI commands; 65/66 followed the expected route; no uncaught error |
| **CASE2** | DeepSeek-driven coding agent | open workspace, approval and interaction, Todo/Goal guards, long tool chains, an independent Subagent Journal | completed a multi-stage extension of a 5G discrete-event simulator; all 67 tests passed |
| **CASE3** | Planned unified assistant entry | one entry Journal routing work to persistent project or domain Journals | not implemented and excluded from the verified claims |

> The following numbers come from saved Journals and the corresponding code
> snapshots. They are engineering experiment records, not a standardized
> cross-project benchmark. Model, language, feature scope, and counting method
> all affect the result.

### CASE1 — real terminal-control assistant

CASE1 reproduces the essential behavior of comparable Android terminal
assistants without moving an Android implementation into another AgentLoop.
The stable system prompt and Bash function schema remain fixed. Each user query
matches only the relevant applications and detailed CLI usages. One Catalog,
Parser, and Dispatcher sends a command to either a Mock or ADB handler. Pending
candidate state stays inside the tool domain and is exposed to the next turn
through dynamic context.

The main plugins each retain one responsibility:

| Plugin | Subscribes → produces | Responsibility |
|---|---|---|
| `RuntimeContext` | `user.message` → `context.dynamic` | combine application/tool-intent matching as ordinary ContextSource functions; no `context.contribution` relay events |
| `AgentFlow` | `context.dynamic` / `tool.result` → `content.request` / `llm.request` | advance generation without executing a model or tool |
| `Content` + sources | `content.request` → reply / `llm.request` | one plugin selects the first matching ordinary source in assembly order |
| `ContextAssembler` / `LLMProvider` | `llm.request` → `llm.invoke` → generated facts | project model input and produce one complete decision |
| `Tools` | `tool.call` → `tool.result` | execute the single Bash function, then route its CLI through Parser, Dispatcher, and a focused handler |
| `CompressHistory` / `Output` | generation / reply → checkpoint / presentation | create history checkpoints and publish final output without entering orchestration |

```mermaid
sequenceDiagram
  participant U as User
  participant J as Journal
  participant C as Context plugins
  participant F as AgentFlow
  participant L as Content / LLM
  participant B as Bash + Dispatcher
  participant A as Android / ADB

  U->>J: user.message
  J->>C: match app + tool intent
  C->>J: context.dynamic
  J->>F: context.dynamic
  F->>J: content.request
  J->>L: llm.request → llm.invoke
  L->>J: llm.generated + tool.call(bash)
  J->>B: CLI command
  B->>A: selected handler effect
  A-->>B: observation / failure
  B->>J: tool.result
  J->>F: tool.result
  F->>J: llm.request
  J->>L: continue with the same turn context
  L->>J: assistant.message
```

On 2026-09-25, one device smoke Session executed 66 consecutive user requests.
The runner deliberately waited five seconds between requests so that the phone
could be observed. Model latency depends on the configured API.

| Metric | Result |
|---|---:|
| User requests / distinct CLI commands covered | 66 / 56 |
| Requests following the expected tool route | 65 / 66; one recovery retried after a failure |
| Uncaught runtime errors | 0 |
| Journal events / JSONL size | 880 / about 282 KB |
| Model generations | 133, or 2.02 per user request |
| Input tokens per model call | mean 6,055; median 6,508; maximum 10,638 |
| Output tokens per model call | mean 27.8; median 25 |
| Request duration, excluding the deliberate wait | mean 2.47 s; P95 5.09 s; maximum 11.69 s |

The experiment preserves failures as evidence. Contact-number formatting,
nearby search, and several ADB capabilities produced business errors, but each
error returned as a `tool.result`, allowing the model to explain, retry, or
degrade without breaking the Journal drain. The final complete model input was
still 10,638 tokens after 66 turns, so a 32K configured window did not require
compaction. A linear estimate using 200K usable tokens suggests more than 1,300
similar requests in one Session. Earlier experience with this dynamic-context
strategy measured cache hit rates above 72%; that figure was not measured by
this smoke run. The central result is that intent-matched tool instructions and
short tool results can maintain high information density.

#### CASE1 code-size snapshot

Compared with modules serving similar responsibilities in a comparable agent
product:

| Scope | Knot CASE1 | Android baseline | Knot share | Size difference |
|---|---:|---:|---:|---:|
| Agent stack, excluding UI | 5,636 | 29,544 | 19.1% | about 5.2× smaller |
| Tool execution, ADB + Catalog | 2,962 | 17,590 | 16.8% | about 5.9× smaller |
| Runtime, Journal + plugins | 2,393 | about 10,653 | about 22% | about 4.5× smaller |
| Test code | 2,012 | 21,939 | 9.2% | about 10.9× smaller |

The significance of this snapshot is not language choice. It is that Catalog,
context matching, CLI parsing, Dispatcher, and handlers each have one source of
truth, so reproducing the same core behavior requires materially less business
code.

```bash
npm install
npm run case1
```

The default command uses a deterministic mock provider and Android-shaped mock
tools, with no API key required. With an ADB device and Provider configured,
`npm run smoke:case1-adb` replays the consecutive device smoke suite.

### CASE2 — coding agent

CASE2 does not define a coding state machine. `CodingFlow` advances from user
messages and tool results, then applies Steering, Todo, and Goal guards before
committing a final response. File operations, approval, Ask, Todo, Goal, and
Subagent are ordinary tools. A Subagent is a persistent Session with its own
Journal, model configuration, and workspace; its parent receives only the
committed summary.

| Plugin | Subscribes → produces | Responsibility |
|---|---|---|
| `WorkspaceContext` | first `user.message` → `context.fixed` | fix the workspace and root `AGENTS.md` / `CLAUDE.md` in context; reuse existing facts on restore, without automatic file-change tracking |
| `CodingFlow` | user / fixed-context / tool / generation events → next request or reply | wait for initial fixed context, advance the task, and apply guards before committing completion |
| `ContextAssembler` / `LLMProvider` | `llm.request` → `llm.invoke` → generated facts | project Journal facts into model input and invoke the model |
| `Tools` | `tool.call` → `tool.result` | run read/write/edit/bash/ask/todo/goal/spawn_agent; the Host assembles search from a configured DeepSeek search source; tool policy reads committed Journal configuration |
| `CompressHistory` | `llm.generated` → checkpoint events | create a semantic checkpoint only when the context threshold is reached |
| `JSONL` / `Output` / `ControlledBoundary` | facts → storage / UI / pause | assemble platform behavior as plugins or Host ports |

```mermaid
sequenceDiagram
  participant U as User
  participant J as Parent Journal
  participant W as Workspace context
  participant F as CodingFlow + Guards
  participant L as LLM
  participant T as Tools / Approval
  participant S as Child Session Journal

  U->>J: user.message
  J->>W: load workspace constraints
  W->>J: context.fixed (only when absent)
  J->>F: context.fixed ready / subsequent user.message
  F->>J: llm.request
  J->>L: llm.invoke → projected messages + tool schemas
  L->>J: reasoning + content + tool.call
  J->>T: read / edit / bash / ask / todo / goal
  T->>J: tool.result
  J->>F: continue or run completion guards
  opt delegated investigation
    T->>S: create persistent Subagent Session
    S->>S: independent Journal + tools + LLM
    S-->>T: final summary
    T->>J: spawn_agent tool.result
  end
  F->>J: assistant.message
```

On 2026-09-20, `deepseek-flash` inspected and incrementally extended a real 5G
discrete-event simulation workspace. It first understood the existing DES,
then added UE traffic models and network-element capacity specifications, and
finally implemented ingress flow control and periodic retry. One architecture
investigation was delegated to an independent Subagent. The test suite grew
from 40 to 67 tests, all passing.

| Metric | Parent Session | Subagent Session |
|---|---:|---:|
| User / steering inputs | 4 | 1 delegated task |
| Journal events | 783 | 47 |
| JSONL size | about 1.03 MB | about 236 KB |
| Model generations | 140 | 7 |
| Individual tool calls | 145 | 15 |
| Main tool distribution | edit 84 / bash 28 / read 21 | read 13 / bash 2 |
| Final model input | 151,364 tokens | 30,673 tokens |
| Mean model input | 97,821 tokens | 18,819 tokens |
| Median model output | 315 tokens | 133 tokens |

The Parent Session reported 94,073 cumulative output tokens, including
DeepSeek's long reasoning; that is not the amount of user-visible text. The run
demonstrates that long-horizon work, parallel tools, and a persistent Subagent
can share the same event model. It also shows that CASE2 should next optimize
model-visible context, tool-result budgets, and reasoning cost rather than add
more Journal-kernel behavior.

#### CASE2 and Pi historical code-size snapshot

These counts come from local repository snapshots. Pi's loop, harness, session,
and product layers are different boundaries, so the table reports each instead
of presenting any single count as the definitive comparison. The UI counts describe
the earlier custom Web, before DSH integration, not the current total frontend size.
Current adapter counts are listed under [Workbench](#workbench).

| Scope | Knot | Pi baseline | Observation |
|---|---:|---:|---|
| Agent brain: orchestration + tools + persistence | about 2,572 | loop about 1,861; harness about 10,800; harness + session about 30K | Knot is about 40% larger than the loop alone, but 76%–91% smaller than the complete harness boundaries |
| Agent brain + LLM clients | about 2,572, including OpenAI / DeepSeek | about 1,861 + 24,384 | Knot's current Provider layer is thin and supports fewer variants |
| Runnable coding product, excluding the LLM package | about 7,372 | about 95K | about 12.9× smaller in this snapshot |
| Web / terminal UI increment | about 1,859 | about 18K TUI | about 9.7× smaller in this snapshot; product capabilities are not identical |
| Tests | about 8.7K | Pi agent tests 12K+ | test scopes differ; this only describes maintenance volume |

Less code is not the objective and does not prove better outcomes. The more
important signal is that CASE2 already contains real tools, persistence, Flow,
guards, approval, Web Run, and Subagent, while each concern still has an
independent, explainable, replaceable boundary. The reduction follows from
lower responsibility entropy.

```bash
export KNOT_BASE_URL="https://example.com/v1"
export KNOT_MODEL="model-name"
export KNOT_API_KEY="..." # when required by the service
npm run case2 -- "inspect this workspace and run its tests"
```

CASE2 can inspect, modify, and verify files in a real workspace. Its CLI uses an OpenAI-compatible provider; the mock provider is used by tests and reproducible Case assemblies. Workbench providers can be managed in the UI or loaded from the Host environment.

## Workbench

Two frontends currently use the same Knot Host: **the official DSH shell is the current Run integration**, while the earlier custom Web retains the minimal Studio Case/Run surface. They have separate browser UI preferences but can access the same persistent Sessions.

### DSH shell: current Run

Install once:

```bash
npm install
npm --prefix web-dsh-reference install
```

Start in separate terminals:

```bash
# Terminal 1: Knot Host API
npm run workbench:api

# Terminal 2: DSH frontend with real Knot data
VITE_KNOT_DSH_MODE=workbench npm run dsh-reference:dev -- --port 4178 --strictPort
```

Open `http://127.0.0.1:4178/`. Without `VITE_KNOT_DSH_MODE=workbench`, this frontend runs an isolated Fixture, not your real Agent.

- create, select, and restore Sessions;
- stream content, reasoning, tool calls, and tool output;
- use native approval, Ask, Todo and child navigation, with read-only native Goal presentation;
- change the next submitted model, reasoning effort and approval policy while idle;
- use native Chat / Trajectory beside Journal, tool analytics, context analysis and plugin/protocol tabs;
- inspect a read-only Session cover with configuration, Usage, Todo/Goal and original queries that link back to Chat.

```text
DSH Web / Client Cordis → presentation and RPC/SSE adapter → Knot Host
                                                               ↓
                                                  Assembly → plugins → Journal
```

Client Cordis runs the DSH presentation layer, not Knot business plugins. No DSH Host, AgentLoop or tool execution backend is activated. B1–B5 and S1–S5 add about **2,279 lines** of owned production integration and **1,220 lines** of tests/smoke scripts (physical lines including comments/blanks, `2b7c94c` → `91f2200`; excluding official code, fixtures, lockfile and docs). Aggregate npm packages still install backend dependencies transitively; installation does not mean execution.

Graceful pause does not abort a process, and auto approval is not a sandbox. Unconnected attachment, fork and dynamic-plugin operations are hidden or explicitly refused. Missing usage is not zero, output rate is not decode TPS, and subscription matches are not handler executions. See the [integration and deviation guide](web-dsh-reference/README.md).

### Earlier Web and Studio

```bash
npm --prefix web install
npm run workbench
```

Open `http://127.0.0.1:4317/`. Stop a Host already running in terminal 1 before using this command, to avoid a port conflict.

Studio retains real Assembly descriptions, Projects/Cases, Mock/real Runs, basic event assertions and observed Flow lists. Generation/Publish/Validation have been removed. There is no executable source snapshot, visual plugin editor, Dataset Eval or experiment comparison. The DSH shell has no Studio editor; further visual-composition expansion is paused.

## Model configuration

Workbench currently uses Host-side Provider Profiles. Credentials are never returned to the browser or written to the Journal.

In the DSH shell, **Settings → 模型 Provider** supports adding, editing, testing, deleting and setting a default profile. Environment profiles are read-only. Testing requires confirmation and makes a real model request. Profiles default to local `.knot/providers.json` with `0600` permissions; Host environment can override its location. Keys are sent only when created/updated and never returned, journaled or stored in browser storage.

Official DeepSeek example:

```bash
export DEEPSEEK_API_KEY="..."
export KNOT_DEEPSEEK_MODEL="deepseek-flash"       # optional
export KNOT_DEEPSEEK_THINKING="enabled"           # optional
export KNOT_DEEPSEEK_REASONING_EFFORT="high"      # optional
npm run workbench:api
```

Generic OpenAI-compatible CASE1/CLI example:

```bash
export KNOT_BASE_URL="https://example.com/v1"
export KNOT_API_KEY="..."
export KNOT_MODEL="model-name"
npm run case1
```

An empty Session has no precommitted model/approval facts. UI changes remain pending until the next `submit()` appends changed `inference.configured` / `approval.policy.configured` facts; unchanged values are not repeated. Restore uses the latest Journal configuration, or Host defaults when absent, not old descriptor configuration fields. OS keychain integration and remote multi-user deployment remain unimplemented.

## Concept relationships

```text
Project
├── Assembly / Agent definition
│   └── plugins, tools, prompt, policies
├── Cases
│   ├── input, fixture, assertions, eval settings
│   └── Runs
└── Sessions
    ├── Assembly identity (not a code snapshot)
    ├── Journal
    └── parent / child relationship
```

- **Project:** the durable development, validation, and export boundary.
- **Assembly:** an executable agent definition.
- **Case:** a reproducible test or experiment, not the agent itself.
- **Session:** one Assembly execution and its Journal.
- **Run:** the Session and evaluation evidence produced by executing a Case.

Generation was an explored publishing concept, not a current feature. A Session records Assembly identity, which does not restore historical source code or replay external effects. See [Core concepts](docs/concepts.md).

## Plugins and ecosystem

A plugin is still the smallest possible TypeScript function:

```ts
type Plugin = (journal: Journal) => void
```

Installation is one function call. A plugin may keep private mechanical state in a closure, while business facts belong in the Journal and external state belongs to its real external owner.

Knot has no marketplace. Thin internal `definePlugin` / `defineAssembly` helpers keep CASE1/CASE2 executable declarations, registration order and inspection metadata single-sourced. They are not frozen public ecosystem APIs. DSH Client plugins are presentation extensions, not Journal plugins.

The expected minimum shareable unit is:

```text
implementation + metadata + focused test or Case
```

not merely code that can be loaded without evidence that its composition is correct. See [Plugin practices](docs/plugin-best-practices.md).

## Proven and still under test

Executable Cases currently demonstrate that:

- one 56-line Journal kernel supports two materially different agents;
- trace, JSONL, context, tools, LLMs, and guards need no kernel privilege;
- mock and real providers can preserve the same business boundaries;
- Web and Host connect through ports without entering the Journal kernel;
- adding one domain plugin need not create direct dependencies in other plugins.

Still to be measured publicly:

- whether the current code-size snapshot holds as features grow and actually reduces long-term maintenance cost;
- event dispatch throughput, latency, and memory;
- context duplication, cache hit rate, and useful information density;
- task success and path efficiency across model/Assembly combinations;
- long-term compatibility of Assembly, Plugin, Case, and export formats.

Knot does not claim to invent event queues, event sourcing, or plugins. It asks whether applying those principles rigorously to an agent harness can produce a small, explainable, executable system that moves from experiments to delivery.

## Test

```bash
npm test
```

Tests replace real providers, tools, and output boundaries through assembly rather than maintaining a separate test runtime.

## Contributing

The most useful contributions currently bring evidence rather than abstraction:

- a real Agent Case;
- a Provider adapter;
- a plugin with a focused test;
- a reproducible context or tool failure;
- a model/harness comparison experiment;
- a real Workbench Run/Studio product slice.

Read [`AGENTS.md`](AGENTS.md) first. Start from an end-to-end trajectory, clear responsibilities, and an observed boundary. Do not pay for a boundary that does not exist yet.

## Documentation

- [Core concepts and relationships](docs/concepts.md)
- [Plugin design and practices](docs/plugin-best-practices.md)
- [DSH integration and current boundaries](web-dsh-reference/README.md)
- [Current Workbench product model](docs/product/workbench-product-model.md)
- [Workbench capability ledger](docs/product/workbench-user-stories.md)
- [Accepted CASE1 boundaries](docs/design/case1-active-boundaries.md)
- [CASE2 coding agent design](docs/design/case2-coding-agent-spec.md)
- [Minimal-kernel review response](docs/reviews/minimal-kernel-review-response.md)
