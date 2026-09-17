# CASE2 MAAS real-model validation

Date: 2026-09-17

Model: `qwen3-coder` through the configured Lingxi MAAS OpenAI-compatible endpoint. MAF and API reasoning were disabled. Credentials were supplied only through `KNOT_API_KEY` and were not stored in the repository.

The isolated fixture remains under the ignored local path:

```text
.local/case2-maas-workspace
```

## Run 1: normal coding task

Task: read the fixture requirements, implement `applyDiscount`, add tests and run `npm test`.

Observed result:

- 10 model invocations;
- 55 Journal events;
- about 52 seconds total;
- 5 read calls, 2 edit calls, 1 bash call and 1 todo.write call;
- every call produced exactly one ordered result;
- bash returned exit code 0;
- final fixture tests: 4/4 passed.

The model followed read → edit → test → reread → final. It did not parallelize independent reads, so the behavior was correct but token/latency efficiency was not optimal.

## Run 2: forced tool-error recovery

Task: first read an intentionally missing `OPTIONAL.md`, then implement `formatPrice`, add tests and verify.

Observed result:

- 105 Journal events;
- about 68 seconds total;
- missing-file read errors were converted to `tool.result` and the model continued;
- two `edit` calls returned `old_text_not_unique`; the model reread and adjusted;
- one edit corrupted JavaScript syntax; bash returned exit code 1;
- the model read the diagnostic, repaired the complete file with write, and reran tests;
- final bash returned exit code 0;
- final fixture tests: 5/5 passed.

This validates three separate tool failure layers:

1. thrown environment errors are closed by ToolsPlugin as `tool_error`;
2. expected tool-domain failures remain structured results such as `old_text_not_unique`;
3. command/test failures remain normal bash results and can drive another model decision.

No failure escaped the tool domain or interrupted the Journal drain.

## Newly proven UI boundary

MAAS streamed explanatory content before tool calls. Those previews are displayed but never become `assistant.message`. The previous Terminal UI retained every unmatched preview in an array, creating unbounded stale deduplication state. This was hypothetical during the earlier review but occurred repeatedly in both real runs.

The UI now retains only the current generation preview. Opening the next generation clears unmatched prior preview state; a byte-identical final event for the current generation is still deduplicated.

## Local transport note

The MAAS server negotiates legacy TLS renegotiation. Node 25 rejects it by default. Validation used a process-local ignored OpenSSL configuration with `--openssl-shared-config`; the repository default TLS behavior was not weakened.
