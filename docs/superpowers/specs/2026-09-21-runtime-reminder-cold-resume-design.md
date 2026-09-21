# Persist runtime reminders so cold resume keeps the provider prefix

Date: 2026-09-21
Module: `zcode-cli` (`core`, `contracts`, `bootstrap`), `shared`

## Problem

Several `<system-reminder>` attachments are committed to the in-memory message history but never written to the session store: `output_style` (every turn when an output style is active), `runtime_mode` (plan mode), `plan_mode_exit`, `hook_context` (SessionStart / UserPromptSubmit / Stop hooks), `model_anomaly`. While the process lives they stay in every provider request, so the prefix is stable. After a cold resume they are gone, so the first request diverges from the pre-restart prefix at the position of the first missing reminder. With an active output style that position is the first turn, and the whole conversation misses the prompt cache once per resume.

## Goal

After a cold resume the provider request must be byte-identical to the request the live process would have sent. Log only, no UI change: these notices are `model-only` and stay hidden.

## Design

### One new synthetic source: `runtime_reminder`

- Added to `SYNTHETIC_USER_MESSAGE_SOURCES` (`contracts/src/interfaces/session-store.port.ts`) and mirrored in `zcodeSyntheticUserMessageSourceSchema` (`packages/shared/src/zcode-protocol-legacy-types.ts`).
- Semantics kind `system_reminder` (`synthetic-notice-metadata.ts`), origin `synthetic` in the v4 projection (`event-normalizer.ts`, `projection-rows.ts`). The shared projection policy already hides `model-only` messages, so nothing is rendered.
- The real reminder source travels in `part.metadata.runtimeMessage.source`. The hydrator already restores any provider-visible meta reminder from that field (`session-history-hydrator.ts` `isRestorableSystemReminderAttachmentSource`), so no hydrator change is needed.

### One write path: `persistRuntimeReminderNotice`

`core/src/runtime/methods/runtime-reminder-persistence.ts`. Owner of the write is the runtime that committed the reminder. It calls the existing `persistSyntheticUserNoticeForSession` with `source: "runtime_reminder"` and the runtime metadata. Ordering is guaranteed by the store: `message.sequence` is assigned at insert, so callers `await` the write right after the in-memory commit and before the next message is persisted.

Call sites:

| reminder                                         | site                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan_mode_exit`, `runtime_mode`, `output_style` | `turn-loop.ts`                                                                                                                                           |
| `hook_context`                                   | `hooks.ts` `injectHookAdditionalContextIntoMessageHistory` (now async, takes `traceContext`; callers in `turn.ts`, `turn-stop.ts`, `resume.ts` await it) |
| `model_anomaly`                                  | `turn-tool-warnings.ts`                                                                                                                                  |

`SYSTEM_REMINDER_PERSISTED_SOURCES` now lists these five sources so compaction bookkeeping counts them the same way it counts `todo_reminder`.

### Known gap

The SessionStart hook on the very first turn runs before `ensureSessionPersisted`. The helper skips the write when the session row does not exist yet, which is the old behaviour for that one case. Fix path: persist it right after `ensureSessionPersisted` with an explicit earlier sequence. Not done because it needs a store API change and affects only sessions whose SessionStart hook emits context.

## Testing

- `core/test/runtime-reminder-hydration.test.ts`: a persisted `runtime_reminder` message with `runtimeMessage.source = output_style` and one with `hook_context` hydrate back to attachment entries with those sources, in order, after a real user message.
- Run: `pnpm --filter @zcode/core build && node --import tsx --test test/runtime-reminder-hydration.test.ts` inside `apps/zcode-cli/packages/core`.
- Field check: resume a session that has an output style, look at the first `model.request.started` log. `prefix.kind` must be `first` (fresh runtime) and the following request must be `append`; before this change the second request reported `diverged` at the first `output_style` index.

## Out of scope

`date_change`, `referenced_session_context`, `incoming_message`, `prompt_attachment`, `diagnostics` stay per-request. They are rare or already re-derived on resume.
