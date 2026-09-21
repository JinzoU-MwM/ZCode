# Cross-process prefix diagnostic and first-turn reminder persistence

Date: 2026-09-22
Module: `zcode-cli` (`core`, `contracts`)

## 1. Persist the request fingerprint across processes

### Problem

The prefix-divergence diagnostic (`2026-09-21-prefix-divergence-diagnostic-design.md`) kept the previous request's fingerprint in memory, so the first request after a cold resume always logged `kind: "first"`. The most important case, "does a resumed session send the same prefix as the live process did", could only be checked with an offline script over the rollout dump.

### Design

- New session entry type `runtime/provider_request_fingerprint` (`SESSION_ENTRY_PROVIDER_REQUEST_FINGERPRINT`). `persistProviderRequestFingerprint` upserts one entry per session (fixed id `<sessionId>:provider-request-fingerprint`, `touchSession: false`) right after the fingerprint is computed in `runRegularTurnLoop`. Size is 64 bytes per message plus source labels; measured 1.3 KB for a 15-message session.
- `resumeFromStore` calls `restoreProviderRequestFingerprint` after the session is marked persisted; `parseProviderRequestFingerprint` validates the stored shape and drops anything malformed.
- Failures are logged at warn and never affect the request.

### Field result

Three consecutive processes on one session (fresh, `--continue --mode plan`, `--continue --mode plan`): the resumed processes logged `append` with `sharedPrefixLength` 10 and 13 respectively. Before this change they logged `first`.

## 2. Queue reminders written before the session row exists

### Problem

`persistRuntimeReminderNotice` skipped the write when `sessionPersisted` was false. The SessionStart hook on the first turn runs before `ensureSessionPersisted`, so a hook that emits context was in memory but never on disk, and the prefix after a cold resume diverged at that position.

### Design

- When the session is not yet persisted, the reminder is pushed onto `pendingRuntimeReminderNotices` (owner: the runtime instance).
- `ensureSessionPersisted` flushes the queue in order immediately after setting `sessionPersisted = true`, which is still before the first user prompt is persisted, so DB `sequence` order matches the in-memory order.

## Testing

`core/test/runtime-reminder-queue-and-fingerprint.test.ts`: queue-then-flush order, fingerprint upsert and restore yielding `append`, malformed entries ignored. Plus the field run above.
