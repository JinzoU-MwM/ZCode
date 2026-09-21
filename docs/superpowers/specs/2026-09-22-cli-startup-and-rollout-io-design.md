# CLI cold start compile cache and rollout dump deduplication

Date: 2026-09-22
Modules: `scripts/zcode-distribution/runner.mjs`, `packages/services` (agent spawn), `zcode-cli/adapters` (model-io rollout)

## 1. V8 compile cache for the agent bundle

### Problem

`agent/zcode.cjs` is a 29.6 MB single-file bundle. Every process start parses and compiles it from scratch: `zcode --version` measured at ~635 ms, and every Desktop agent spawn and every headless `--prompt` invocation pays the same.

### Design

Node 22.1+ can persist V8 code cache per module (`module.enableCompileCache` / `NODE_COMPILE_CACHE`). The cache only covers modules loaded _after_ it is enabled, so the bundle cannot enable it for itself; the two callers do:

- `runner.mjs` (the `zcode` command of the CLI distribution) calls `enableCompileCache(dir)` right before importing the agent. Namespace import plus a runtime `typeof` check so older Node links without error.
- `ZCodeAgentProcessManager` (Desktop and Web hosts) sets `NODE_COMPILE_CACHE=dir` in the spawn env; Node applies it before loading the entry.

`dir` = `<os.tmpdir()>/zcode-compile-cache-<process.version>-<uid>`, keyed by Node version and user so upgrades and multi-user machines never share a cache. `ZCODE_DISABLE_COMPILE_CACHE=1` opts out; an explicit `NODE_COMPILE_CACHE` in the parent env wins. Failures are silent: the cache is an accelerator, never a dependency.

### Measurements

| entry                                      | cold   | cached |
| ------------------------------------------ | ------ | ------ |
| shim `enableCompileCache` + require bundle | 675 ms | 410 ms |
| distribution runner `zcode version`        | 710 ms | 500 ms |

Cache on disk: 6.7 MB. Behaviour unchanged.

## 2. Rollout model-io: write the tool table once

### Problem

Production writes every model request to `<cli storage>/rollout/model-io-<session>.jsonl` with `appendFileSync` on the request path. A captured record was 64 KB, of which 51 KB was `request.body.tools`, identical on every request of the session. Messages were already stored as deltas; tools were not.

### Design

`compactModelIOTools` in `runner-debug.ts`, applied after message compaction: hash `body.tools` (sha256 of its JSON); if it equals the hash remembered in the in-process compaction state for that file, drop `body.tools` and write `body.toolsRef = <hash>`; otherwise write the tools in full plus `body.toolsHash`. The state already lives in `modelIOCompactionStates`, so no file is read back. Readers reconstruct tools from the nearest earlier record in the same file whose `toolsHash` matches. Full-retention mode is unaffected.

### Measurements

Same session shape as before: first record unchanged, later records ~13 KB instead of ~64 KB (about −80% bytes written per request).

## Testing

`adapters/test/model-io-tools-dedupe.test.ts` (node:test over `dist`): first record keeps tools and stamps the hash, unchanged tools collapse to `toolsRef`, changed tools are written in full, records without tools are untouched. Runner and spawn env verified by timing runs above.
