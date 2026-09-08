# knot-agent

The smallest journal-first agent prototype.

Before changing anything here, read [AGENTS.md](AGENTS.md): it holds the kernel
contract, the plugin-layer rules earned from CASE1, and the questions that are
still open.

## CASE1: Android call flow

The isolated CASE1 assembly reproduces this path with standard function calling:

`user.message -> shortcut -> bash(contact) -> LLM -> bash(select 1) -> LLM -> assistant.message`

Run it with the deterministic mock provider:

```sh
npm run case1 -- '给李行素打电话'
```

The answer is written to stdout; the complete event trace and elapsed time are
written to stderr. To select the OpenAI-compatible provider, set
`KNOT_BASE_URL`, `KNOT_MODEL`, and optionally `KNOT_API_KEY`,
`KNOT_CONTEXT_WINDOW`, and `KNOT_REQUEST_EXTRA_JSON`.

A minimal experiment: can an agent be driven only by an append-only journal and
plugins reacting to events?

There is no business `AgentLoop` and no runtime object. A plugin subscribes to
event types, runs its own logic, and appends new events or nothing at all. When
those subscriptions form a cycle the agent keeps going; when nothing new is
appended it stops.

```text
session.start
  -> system prompt plugin -> system.prompt
user.message
  -> llm -> tool.call
  -> tools -> tool.result
  -> llm -> assistant.message
  -> output
```

Plugins never call each other. They only read the journal and append events.

## Run

Node.js 20+ is required.

```bash
npm install
npm start -- "Look up the status of knot-agent and report it."
```

With no model configuration, the program uses a deterministic mock LLM and runs
the full tool-call cycle. Trace lines are written to stderr; the final answer is
written to stdout.

To use an OpenAI-compatible Chat Completions endpoint:

```bash
export KNOT_BASE_URL="https://example.com/v1"
export KNOT_API_KEY="..."
export KNOT_MODEL="model-name"
npm start -- "Use demo_lookup to check knot-agent."
```

Provider-specific request fields can be supplied without changing the plugin:

```bash
export KNOT_REQUEST_EXTRA_JSON='{"model_provider":"maas","_lingxi_maf_enabled":false}'
```

Run tests:

```bash
npm test
```

## The entire kernel contract

`src/journal.ts` is the whole kernel. It imports nothing and knows no business
event type.

```ts
type Event = { readonly type: string; readonly data: unknown }
type Handler = (event: Event) => void | Promise<void>
type Plugin = (journal: Journal) => void

interface Journal {
  append(type: string, data: unknown): Event
  read(): readonly Event[]
  subscribe(type: string, handler: Handler): void
}

function createJournal(): { journal: Journal; runUntilIdle: () => Promise<void> }
```

Delivery semantics:

1. The journal is append-only; an appended event is delivered exactly once.
2. Events are delivered in journal order, so events appended by a handler are
   handled after every subscriber of the current event has finished.
3. Subscribers of one event run serially in registration order. `*` is only a
   match-all selector and holds its own registration position, so a trace plugin
   has no privilege over any other plugin.
4. An event with no subscriber is legal. The kernel cannot know whether a
   business event requires a consumer; the plugin defining that protocol must
   decide.
5. A handler that throws aborts the drain and the error propagates unchanged.
   Nothing is retried and no error event is appended.
6. `runUntilIdle` belongs to the assembly layer, never to a plugin, and rejects
   if it is re-entered.

Installing a plugin is one call: `plugin(journal)`. Assembly happens in
`src/main.ts`, which is the only place that knows what this agent is made of.
Tests are just a different assembly — see `test/agent.test.ts`, where the same
trace plugin writes into an array instead of stderr.

`src/protocol.ts` holds the event types those plugins agreed on. It is a plain
declaration file, not part of the kernel.

## Deliberately absent

Persistence, multiple sessions, priority, capabilities, endpoints, dependency
graphs, retries, compaction, permissions, concurrency, parallel tool calls,
streaming, dynamic plugin loading, TUI, web UI, and remote plugin protocols.

They will be added only after a real plugin cannot be implemented correctly
without changing the kernel. The reasoning behind the current shape is in
[docs/reviews/minimal-kernel-review-response.md](docs/reviews/minimal-kernel-review-response.md).
