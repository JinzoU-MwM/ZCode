## Core Principles

- Before adding or changing behavior, update the corresponding spec first; create the directory on demand if it does not exist. Clarify product rules, state owners, interfaces, and acceptance scenarios before implementing code.
- Treat the currently checked-out source, `package.json`, and the architecture policy as the source of truth. Instructions must only describe features, commands, and files the current repository provides; when removing a feature, clean up references in instructions and skills at the same time.
- When locating a problem, investigate the cause first unless code changes were explicitly requested. Combine source, logs, and runtime evidence, and distinguish confirmed causes from hypotheses still to be verified.
- Preserve local changes unrelated to the task; do not restore removed modules or internal dependencies on your own.

## Commands and Repository Structure

Run `node scripts/check-workspace-freshness.mjs` before starting work to check the baseline. The Node version is defined by `mise.toml`.

The following commands run from the repository root:

| Purpose                         | Command                                              |
| ------------------------------- | ---------------------------------------------------- |
| Type check                      | `pnpm typecheck`                                     |
| Lint                            | `pnpm lint` / `pnpm lint:fix`                        |
| Format check                    | `pnpm fmt:check`                                     |
| Desktop development             | `pnpm dev:desktop`                                   |
| Web development                 | `pnpm dev:web`                                       |
| Pre-push check                  | `pnpm verify:pre-push` (Lint and architecture check) |
| Architecture check              | `pnpm architecture:check --changed`                  |
| Module reading bundle           | `pnpm architecture:context <module-id>`              |
| Unused dependencies and exports | `pnpm knip`                                          |
| Export reference lookup         | `pnpm dep:refs --list-exports <file>`                |

Test entry points are defined by the target package's current `package.json` and the actual test files; do not assume a unified unit-test or E2E command exists.

- `packages/desktop`: Electron main, host, renderer.
- `packages/web`, `packages/server`: Web client and server.
- `packages/ui`: shared React components, hooks, and Zustand store.
- `packages/services`: business services; `packages/rpc`: RPC framework.
- `packages/shared`: shared protocols and types; `packages/client`: Agent client SDK.
- `apps/zcode-cli`: Agent CLI and runtime.
- `CONTEXT.md`: plugin store domain vocabulary; read before changing related UI.
- `DESIGN.md`: UI design guidelines; read before changing UI.

## Implementation and Verification

- For code changes, use `.agents/skills/architecture-governance/SKILL.md`: run the architecture check first, then read the governed context of the target module.
- Avoid duplicated state and multiple write paths. Define a single owner, interfaces, dependency direction, event ordering, and idempotency boundaries; never use timeouts to mask synchronization problems.
- When behavior changes, add the corresponding tests first; interaction changes need E2E scenarios. Check that tests and implementation agree, and actually run the available verification. If it was not run or the environment is limited, say so honestly.
- When fixing a bug, explain the cause and the basis for the fix in a comment in English. When you find a design flaw, align with the user first instead of continually adding fallback branches.
- For designs involving state, timing, remote, or asynchronous synchronization, use a diagram to show the owners and the event order.
- You must run `pnpm typecheck` and `pnpm lint` and report the real results; never write existing failures up as passing.
- Use asynchronous file and network IO; cross-package imports go through public entry points and follow the existing path aliases.
- Forbidden: UI calling a Repo directly, a Service referencing a concrete Runtime implementation, cross-domain imports of implementation details, and circular dependencies.

## UI and Platform Boundaries

- Follow `DESIGN.md`, reuse existing components, and account for layout, interaction, theming, and internationalization on both desktop and mobile Web.
- Components access services through `packages/ui/src/hooks/`; platform operations go through `IPlatformService` (`packages/shared/src/platform.ts`), never by calling `window.zcode` directly.
- Handle the differences between Desktop, Web, local, and remote environments through dependency injection, and support Windows, macOS, and Linux.
- Zustand state lives in `packages/ui/src/store/`. Broadcast-synced fields such as theme and language must guard against loops; UI-local state must not be mistaken for server-side truth.
- Files under hooks that contain JSX use `.tsx`.

## Processes, Protocol, and Remote Control

- The Desktop app communicates with the Agent over stdio. Protocol changes must be synchronized into `packages/shared/src/zcode-protocol/index.ts`, with strict types and runtime validation.
- Main is responsible for windows, native operations, process scheduling, and message forwarding; it does not carry task/session business state.
- Each window uses one window-scoped Local Host; local workspaces share that Host. Remote workspaces are managed by the connection registry inside the window; do not create a separate Desktop Remote Host.
- Mobile remote control connects to the desktop's existing Host attachment and reuses the session runtime; do not start a separate Agent, Local Host, or remote session for mobile.
- The Desktop `desktop-continuous` real-time link and the mobile `web-remote-replayable` recovery link must be clearly distinguished. When changing stream, snapshot, queue, or reconnection, verify both semantics at the same time.
- The external relay and Main only do authentication, pairing, heartbeat, forwarding, and attachment scheduling; they do not store business state such as task queues or snapshots.
- Accepted busy/running input is serially admitted by the CLI/runtime `CommandInbox`; the Renderer keeps only unsubmitted drafts and the pending optimistic overlay, and the Host owner/lease is responsible for routing.
- Keep the owner/lease, cross-Host routing, and stale run protection; never remove a boundary check based on a single path alone.

## Workspace Identity

- `workspaceIdentity` is used for identity isolation; `workspacePath` is used for file operations, command cwd, Git, and path display.
- The identity key is uniformly `workspaceIdentity?.trim() || workspacePath`, and applies to deduplication, binding, caching, queues, persistence, and request correlation.
- Remote links pass `workspaceIdentity` and `remoteSessionId` all the way through; never match by path alone.
- New interfaces keep the local path fallback; remote identity reuses the existing construction and parsing utilities, and the format is never hand-written in business code.

## Logging

- UI uses `packages/ui/src/logger.ts`; do not use `console.log` or `window.zcode?.log` directly.
- Agent/session/runtime-related service logging uses `createServiceLogger(scope)` (`packages/services/src/logger/serviceLogger.ts`).
- `debug` is for high-frequency diagnostics such as raw protocol data, streaming chunks, and per-item tool updates; it is not written to disk in production.
- `info` is for production-usable events such as process and session lifecycle, permission results, and one-time initialization.
- `warn` is for recoverable exceptions; `error` is for unrecoverable errors such as crashes, handshake failures, and lost authentication.
- Never write credentials, real user data, or internal service addresses into logs, examples, or commits.
