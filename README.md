# knot-agent

A minimal experiment: can an agent be driven only by an append-only journal and
plugins reacting to events?

There is no business `AgentLoop`. The only loop belongs to the runtime and moves
through journal events in sequence:

```text
user.message
  -> llm
  -> tool.call
  -> tool
  -> tool.result
  -> llm
  -> assistant.message
  -> output
  -> idle
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

```ts
type Event = { seq: number; type: string; data: unknown }

interface Plugin {
  name: string
  subscriptions: string[]
  handle(event: Event, context: PluginContext): Promise<void> | void
}

interface PluginContext {
  append(type: string, data: unknown): Event
  read(): readonly Event[]
}
```

Runtime semantics:

1. Events are immutable and append-only.
2. Events are handled in `seq` order.
3. Subscribers run serially in registration order.
4. Events appended by handlers go to the journal tail.
5. An unhandled event or plugin failure stops the runtime.
6. An empty queue means idle; the kernel does not interpret task completion.

## Deliberately absent

Persistence, multiple sessions, priority, capabilities, endpoints, dependency
graphs, retries, compaction, permissions, concurrency, dynamic plugins, TUI,
web UI, and remote plugin protocols.

They will be added only after a real plugin cannot be implemented correctly
without changing the kernel.
