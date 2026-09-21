# @zcode/dynamic-workflow-runtime

Sandbox harness (the dynamic workflow execution engine). Runs a workflow script in a controlled child process,
and bridges the child's `__host.*` calls over NDJSON to the pure engine core in `@zcode/dynamic-workflow`.

## Dependency boundary

Depends **only** on `@zcode/dynamic-workflow` (workspace) and node built-ins. **Never** import `@zcode/core` /
`@zcode/contracts` / `@zcode/bootstrap` / `@zcode/adapters` — this package is the proof that "the whole sandbox↔engine
pipeline runs app-free".

## Usage

```ts
import { runWorkflowScript } from "@zcode/dynamic-workflow-runtime";

const settlement = await runWorkflowScript({
  scriptText,                 // or lowered: <async function body>
  caps: { maxConcurrency: 16 },
  askSpecs,                   // a site id ∈ the synthesized schemas record is typed
  validate,                   // validate from @zcode/dynamic-workflow (adapted to ValidateFn)
  makeDriver: (sink) => driver, // driver brings its own journal + emit; sink is the engine's upward reporting surface
  signal,                     // optional: AbortSignal
  timeoutMs,                  // optional: wall-clock timeout
});
// settlement: { status: "completed", artifact } | { status: "failed", error } | { status: "cancelled" }
```

## Architecture

```
┌─ parent (harness) ──────────────┐  NDJSON  ┌─ child (vm.createContext) ────────────────────────────────────┐
│ runWorkflowScript               │  stdio   │ ES intrinsics + __host only                                   │
│  - lower(scriptText)            │◀────────▶│  createActor returns a local handle synchronously             │
│  - WorkflowEngine(driver,...)   │          │  ask/worldRead → request the parent process                   │
│  - bridge __host.* ↔ engine     │          │  args frozen as a global (crosses the boundary once at spawn) │
│  - spawn/kill/timeout/abort     │          │  Date.now/Math.random banned at runtime                       │
└─────────────────────────────────┘          └───────────────────────────────────────────────────────────────┘
```

## NDJSON wire protocol

See `src/protocol.ts` (the single source of truth). child→parent: `create-actor` (fire-and-forget) / `request` (ask,
world-read) / `event` (log) / `complete`; parent→child: `response`.

## Build order

Tests and typecheck resolve the dependency through the **built dist** of `@zcode/dynamic-workflow`, so `pretest` /
`pretypecheck` first run `pnpm --filter @zcode/dynamic-workflow build`. On a fresh checkout, `pnpm test` alone is enough;
you will not hit a stale dist.

## Failure adjudication and trade-offs

- The run's adjudication is owned by the engine. Every terminal failure (script throws / child process crashes / timeout / protocol corruption) calls
  `engine.fail(error)` — settling `failed`, cancelling in-flight asks on the driver side, and recording `dwf_run.status =
  "failed"` + `failure_json` in the journal, so the journal and the result seen by the caller agree. The abort signal is the only "true cancellation":
  it calls `engine.cancel()` (settling `cancelled`, resumable). The first-wins finalize on the harness side only handles
  child process cleanup (clear the timer, close stdin, kill the child) and never fabricates a settlement.
