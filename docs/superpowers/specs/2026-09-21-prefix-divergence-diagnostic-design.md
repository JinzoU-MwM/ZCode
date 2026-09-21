# Prefix divergence diagnostic for provider requests

Date: 2026-09-21
Module: `zcode-cli` (`apps/zcode-cli/packages/core`)

## Problem

The runtime reports a cumulative prompt-cache hit rate (`recordMainTurnCacheHitUsage`) but nothing explains a miss. When the provider prefix breaks, no log says which message index changed, which runtime source produced it, or whether the tool list moved. Cache behaviour can only be guessed from the ratio.

## Goal

For every provider request issued by an `AgentRuntime`, compare the projected request with the previous request of the same runtime and log where the prefix diverged. Log only. No protocol, UI, or telemetry changes.

## Design

### Pure helper: `core/src/runtime/helpers/request-prefix-fingerprint.ts`

- `fingerprintProviderRequest({ messages, tools, sourceEntries })` returns
  `{ toolsHash, messageHashes[], messageSources[] }`.
  - Message hash = sha256 of `JSON.stringify({role, content, toolCalls, toolCallId, toolName, isError})`. `cacheControl` is excluded: the marker moves every request by design and must not count as divergence. No key sorting: each message is a clone of the same canonical entry on every request, so key order is stable and a deep copy would only cost allocations.
  - Tools hash = sha256 of JSON of `[{name, description, inputSchema, strict, providerNative}]` in list order. Order matters because tools precede the system prompt in the provider prefix.
  - Cost: one serialization plus sha256 over the request. Measured 1.1 ms for 300 messages / 1.2 MB. Retained state is 64 bytes per message plus the source label.
  - `messageSources[i]` = `sourceEntries[i]?.metadata?.source` (`real_user`, `todo_reminder`, ...) or the message role when no entry is attributed.
- `diffRequestFingerprints(previous, next)` returns a `PrefixDivergenceReport`:

| kind       | meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `first`    | no previous request in this runtime                                           |
| `append`   | previous messages are an exact prefix of next                                 |
| `diverged` | shared prefix shorter than both; `divergedIndex` is the first differing index |
| `shrunk`   | next is a strict prefix of previous (compaction, rewind)                      |

Extra fields: `sharedPrefixLength`, `previousLength`, `nextLength`, `divergedSource`, `divergedRole`, `previousSource`, `divergedAtPreviousTail` (true when the only change is a rewrite of the previous last message, e.g. mid-conversation-system merge), `toolsChanged`.

### Runtime wiring

- `AgentRuntime` gains one field: `lastProviderRequestFingerprint?: ProviderRequestFingerprint`. Owner: the runtime instance. Not persisted.
- `runRegularTurnLoop` computes the fingerprint right after `buildRuntimeProviderRequestMessages`, diffs it against the stored one, stores the new one, and adds the report as `prefix` to the existing `model.request.started` info log. No new log event.
- `rewindMessage` clears the field because history is rewritten; the next request logs `first`.
- Each subagent has its own `AgentRuntime`, so chains never cross runtimes.

### Correlation

The usage log that follows carries `cacheReadInputTokens` under the same `traceId`. A reader joins `prefix.kind`/`divergedIndex` with the cache read count to tell an expected miss (`shrunk`, `toolsChanged`) from an unexpected one (`diverged` at a low index).

## Testing

`request-prefix-fingerprint.test.ts` (node:test, excluded from tsc build):

- append only -> `append`
- middle message changed -> `diverged`, correct index, source from `sourceEntries`
- tools reordered -> `toolsChanged`
- `cacheControl` moved -> still `append`
- next shorter -> `shrunk`
- previous last message rewritten -> `divergedAtPreviousTail`

## Out of scope

UI surface, OTel attributes, per-`querySource` chains for compaction/title/verification, adapter wire-level comparison, automatic "expected vs unexpected" classification.
