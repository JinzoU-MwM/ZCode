# Agent Instructions

This is a TypeScript Node.js Coding Agent CLI that supports mainstream models and operating systems. General working rules follow the [root AGENTS.md](../../AGENTS.md); this file adds CLI-specific rules. The Node.js and package manager versions are defined by [mise.toml](../../mise.toml) and [package.json](../../package.json) in the repository root.

## Working Rules (Most Important)

- Before adding or changing behavior, write or update the corresponding spec first, clarifying product rules, state owners, interfaces, and acceptance scenarios, then implement the code. Prefer reusing existing documents; when missing, create documents and directories on demand, and do not assume a fixed-version design directory exists.
- Next, test cases are critical: they prove whether the result matches expectations.
- Leave a trail: after adding a feature, leave new documentation behind; after a bugfix, write down the cause of the bug in a comment.
- Make the project agent-friendly: leave logs or interfaces behind so an agent can fully take over operations.
- Long-running tasks first: the core agent loop is designed by default for sustained execution of complex tasks, and does not use the number of tool calls as a hard stop. Resource and safety boundaries should be carried by explicit conditions such as automatic compaction at the token/context limit, user cancellation, permission denial, tool timeouts, output truncation, and the provider retry limit.
- A single source file must not exceed 400 lines by default; when it does, it must be split into modules by high cohesion and low coupling first, rather than continuing to pile responsibilities into a large file.
- Constants such as strings and numbers should be extracted into named variables or constants; do not scatter literals directly through business logic, so they can be changed in one place and maintained consistently.
- Before changing the database schema, confirm the approach with the module maintainer, clarifying the migration, compatibility, and rollback strategy.
- Keyboard operation first: all core logic must be reachable via the keyboard. Mouse operation is an enhancement.

## Tool Rules

- Before interacting with the operating system, consider supporting windows, mac, and linux at the same time.
- Keep the default release path as the standard Node.js CLI packaging approach.
- The project's own environment variables are uniformly named with the `ZCODE_` prefix, but do not add environment variables casually; before adding one, its purpose, priority, error behavior, and test coverage must first be defined in the spec of the corresponding feature. Capabilities that can be expressed through a config file, CLI arguments, or session configuration should preferably not be made into environment variables.

## Open-Source Content and Sensitive Information

- The project license and attribution notices are in [LICENSE](../../LICENSE), [NOTICE.md](../../NOTICE.md), and [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) in the repository root. Before introducing third-party code, documentation, prompts, or assets, confirm the source, license, and usage rights, and retain copyright, attribution, and modification notices as the applicable license requires; never delete attribution notices that still apply in the name of open-source cleanup.
- Documentation, examples, test data, logs, and commit messages must not contain real credentials, user privacy, internal service addresses, personal working directories, or content not authorized for publication; examples use fictional data and placeholder values.
- Before release, verify the actual delivery scope; when Git history is included, check the history contents as well. Deletion or replacement in the current files does not mean the history has been cleaned.

## Cross-Platform Compatibility Principles

- All features must be designed for Windows, macOS, and Linux at the same time by default; do not implement based only on the behavior of the current development machine's OS.
- For path handling, prefer cross-platform APIs from the Node.js standard library such as `path`, `url`, and `fs`; do not hand-write path separators, absolute path prefixes, line endings, or temporary directory locations.
- When running external commands, prefer the argument-array form of `child_process.spawn` / `execFile`; avoid relying on shell string concatenation, POSIX-only syntax, pipes, redirection, or built-in commands.
- When invoking system commands, editors, shells, package managers, or executables, consider Windows `.cmd` / `.exe`, paths with spaces, argument escaping, environment variable case sensitivity, and shell differences.
- File system logic must account for differences in case sensitivity, permission models, symbolic link support, executable bits, line endings, and path length limits.
- Terminal interaction must be based on capability detection rather than assuming fixed terminal features; colors, TTY, Unicode, interactive input, window size, and signal handling all need a fallback for non-interactive or capability-limited environments.
- User, cache, config, temporary, and project directories should be obtained through explicit cross-platform resolution logic; do not hardcode Unix-style directory structures.
- When adding capabilities that interact with the system, add or update tests covering cross-platform differences; for behavior that cannot be verified on the current system, state the remaining risk explicitly in the implementation and the notes.

## Module Boundaries and Interface Contracts

- Interaction between modules must go through explicit, limited, stable interfaces.
- Each module should be understandable, testable, and replaceable on its own, and expose strict type declarations, interface definitions, or schema declarations.
- Modules are not directly coupled to implementations; they invoke each other through standardized contracts. Callers must not depend on the callee's internal implementation, directory structure, implicit global state, or undeclared conventions.
- The contract a module exposes should clearly describe capability, inputs, outputs, error shapes, state changes, and side effects.
- When data crosses process, storage, network, plugin, tool call, or LLM boundaries, prefer describing it with a runtime-validatable schema rather than TypeScript types alone.
- When adding a new inter-module interaction, complete the interface contract first, then implement the concrete logic.

## Converging External I/O Boundaries

- All external side effects must be uniformly observable, approvable, cancelable, retryable, queueable, auditable, and testable. Business logic only expresses intent and never touches the outside world directly.
- All external I/O must converge into an explicit infrastructure layer or adapter, including network requests, file system reads and writes, child process calls, environment variable reads, terminal input and output, caches, databases, the system clipboard, and external service access.
- Apart from the entry layer, the infrastructure layer, and adapters, business modules must not call low-level I/O APIs such as `fetch`, `http`, `fs`, `child_process`, or `process.env` directly; they should depend on interfaces, services, or adapters defined within the project.
- I/O adapters must expose stable type declarations or schemas that specify inputs, outputs, error types, timeouts, cancellation, retry semantics, idempotency, and the scope of side effects.
- Network access should go through a unified request entry point, so that timeouts, retries, backoff, authentication, proxies, custom certificates, rate limiting, logging, auditing, and error normalization can be managed centrally.
- File reads and writes should go through a unified file system entry point, so that atomic writes, concurrency control, temporary files, queued writes, permission errors, path normalization, and cross-platform differences can be managed centrally.
- Child process execution should go through a unified execution entry point, so that sandboxing, permission approval, environment variables, timeouts, cancellation, output truncation, streaming output, and exit code normalization can be managed centrally.
- When an I/O operation needs to be made asynchronous, queued, retried, degraded, or audited, handle it in the I/O boundary layer; do not scatter these mechanisms through business logic.

## Tool and Side-Effect Contracts

- Every tool should declare an explicit `inputSchema`, `outputSchema`, whether it is read-only, whether it is destructive, whether it is concurrency-safe, its maximum output size, timeout, cancellation semantics, and permission requirements.
- A tool's side-effect scope should be declared explicitly, for example `none`, `workspace`, `git`, `network`, `system`. The permission system, sandbox, and approval flow should read these declarations instead of guessing ad hoc at the call site.
- Tools with side effects should declare idempotency and recovery strategy wherever possible, to enable later implementation of retries, rollback, queued execution, and failure recovery.
- Large tool results should not be fed directly back into the model context; they should be written to disk or into artifact/storage, returning only a summary, a preview, and a traceable reference.
- External extensions such as MCP, plugins, and subagents must be integrated through capability declarations, schema validation, namespace isolation, and permission gating; they must not gain direct access to internal module implementation capabilities.

## Sessions, Configuration, and Observability

- The coding agent CLI should treat session, message, tool call, permission, checkpoint, queue, and pending state as first-class state objects, supporting resume, fork, rollback, and concurrent sessions.
- The TUI is responsible only for input collection, layout rendering, and transient interaction state, such as the cursor, input box, scroll position, and the current dialog selection; business state such as session, mode, model, tool, todo, permission, and checkpoint must not be stored in the TUI layer, and must be stored by server/bootstrap/core/session and delivered through explicit interfaces or session events.
- Collapse/expand indicators in the TUI uniformly use `+`/`-` (`+` for collapsed, `-` for expanded); do not use `v` and `>`.
- User-interaction capabilities such as confirmation, selection, input, progress, and error recovery should be designed as stable interaction request/response interfaces or session events for both the TUI and ZCode Protocol V4 clients; different clients are only presentation and transport adaptation layers, and the interaction flow must not be hardwired into a single frontend.
- All task execution must carry a propagatable `traceId`. By default a `traceId` corresponds to the full task chain of one top-level session; child sessions, subagents, retried tasks, background queue tasks, and asynchronous I/O created within the session should all belong to the same `traceId`.
- `traceId` sits above `sessionId`; `sessionId`, `turnId`, `messageId`, `toolCallId`, `spanId`, `parentSpanId`, and the like should be structured sub-identifiers under `traceId`, used to reconstruct the full call chain.
- All modules, services, adapters, tool runtimes, provider clients, I/O adapters, and permission decision logic should receive and continue to pass along the unified execution context; never drop, overwrite, or ad hoc generate an unrelated `traceId` midway.
- Any asynchronous task, tool call, external I/O, cross-module call, or child session that cannot be associated with a `traceId` is considered unobservable behavior and should not be introduced.
- Providers, models, MCP, storage, network proxies, and certificates should all be integrated through adapters; session-core must not hardcode a specific vendor, transport protocol, or deployment environment.
- Configuration needs explicit layers and priorities, for example system, user, project, session, CLI arguments, and environment variables; security-related configuration must be traceable to its source.
- Embrace the `.agents Protocol` and `AGENTS.md` conventions; subsequent designs, especially capabilities related to configuration discovery, configuration reading, and priority resolution, must be compatible with the `.agents Protocol` by default.
- Keep debugging and observability entry points from the first version onward, covering model requests, context composition, token/cost, tool calls, I/O, permission decisions, retries, queue backlog, and queue drops.
- Logs, traces, and debug output should avoid leaking keys, tokens, private data, and full user content; when highly sensitive information is needed, it must explicitly go through a controlled debug path.

## Error Handling First

- Errors are first-class design objects. When adding a feature, consider the failure paths, error ownership, propagation, and the final user-facing message first.
- By default, let errors bubble up until they reach a layer that can genuinely handle them. Do not casually swallow errors in low-level modules, merely log them and continue, or convert them into plain strings prematurely.
- Catch errors only when you can recover, retry, degrade, add context, convert them into an actionable user message, or when at the CLI entry boundary.
- When throwing or wrapping errors, preserve the original error cause and add the necessary context, so the call chain and system error information are not lost.
- Users can perceive the deep state of the system; error, waiting, retry, permission, model, tool, and I/O state should all be surfaced up the call chain to user interfaces such as the CLI/TUI, while avoiding leaking keys, private data, and full raw content.
- Low-level business modules must not call `process.exit` directly, print errors to the terminal directly, or decide the final exit code; the CLI entry layer is responsible for uniformly formatting errors, printing messages, and setting the exit code.
- Do not rely on error text for flow decisions; when error types need to be distinguished, use stable error types, error codes, or structured fields.
- Tests should cover key failure paths, especially common CLI errors such as missing configuration, insufficient permissions, network failures, file system exceptions, invalid user input, and external command failures.

## Commit Conventions

- Create an independent commit for each feature-level change.
- Do not mix unrelated features, refactors, dependency updates, and formatting adjustments in the same commit.
- Keep commits small enough to be reviewed independently.
- When a feature's change spans multiple files, commit those files together.
- If a task requires multiple feature-level changes, split them into multiple independent commits in the order they should be reviewed.

## Verification

- Before completing a code change, run `pnpm typecheck` and `pnpm lint` from the repository root; when CLI code is involved, also run `pnpm --dir apps/zcode-cli typecheck` and `pnpm --dir apps/zcode-cli lint`.
- Test entry points are defined by the target package's current `package.json` and the actual test files; do not assume a unified test command exists. Behavior changes must run the corresponding tests, and interaction changes must cover E2E scenarios.
- Honestly record the commands run, their results, and the unverified scope; a missing test entry point, existing failures, or environment limitations must not be written up as passing.
