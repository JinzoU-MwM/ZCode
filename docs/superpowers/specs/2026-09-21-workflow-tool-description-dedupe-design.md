# Deduplicate the workflow facade in tool descriptions

Date: 2026-09-21
Module: `zcode-cli` (`core/src/tool/handlers/*-description.ts`)

## Problem

A captured headless request on a fresh session weighed about 39.4k input tokens: ~34.8k of tool schemas, ~2.6k system prompt, ~0.1k conversation. Nine dynamic-workflow tools accounted for ~26k of the tool tokens. Three descriptions embedded the same TypeScript facade declarations:

| tool                  | description tokens (est.) | of which facade                                            |
| --------------------- | ------------------------- | ---------------------------------------------------------- |
| `CreateWorkflow`      | 8.9k                      | `FACADE_DTS` ~5.6k                                         |
| `SaveWorkflow`        | 6.8k                      | `FACADE_DTS` ~5.6k (duplicate)                             |
| `EvalWorkflowSnippet` | 2.8k                      | `SNIPPET_FACADE_DTS` ~2.1k (strict subset of `FACADE_DTS`) |

The three tools sit behind one gate (`includeDynamicWorkflow`), so the model always sees `CreateWorkflow` whenever it sees the other two. Every request paid ~7.7k tokens for text it already had.

## Design

- `SaveWorkflow` and `EvalWorkflowSnippet` descriptions no longer embed the facade. Each points at the declarations shown in the `CreateWorkflow` description; the snippet description lists the surviving subset by name (`args`, `log`, `files.*`, `git.*`, `world.run`) and the absent names (`agent`, `report`, `artifact`, `phase`).
- `CreateWorkflow` keeps the full `FACADE_DTS`. The compiler still typechecks against the real facade constants, so nothing about validation changes.

Measured on the same prompt after the change: 32.8k input tokens per request (from 39.4k, about 17% less). The prefix is otherwise unchanged, so prompt-cache behaviour is unaffected.

## Testing

`core/test/workflow-tool-descriptions.test.ts` (node:test over `dist`): the facade marker appears in `CreateWorkflow` only, and the other two descriptions reference it.

## Not done

Moving `FACADE_DTS` out of `CreateWorkflow` entirely (another ~5.6k tokens) would require an on-demand reference path; deferred as a separate decision.
