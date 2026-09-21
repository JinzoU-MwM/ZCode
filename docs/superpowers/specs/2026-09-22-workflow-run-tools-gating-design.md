# Show run-scoped workflow tools only when the project has a run

Date: 2026-09-22
Module: `zcode-cli` (`core/src/runtime/methods/workflow-run-tools.ts`)

## Problem

Four dynamic-workflow tools only make sense with a `runId` in hand: `GetWorkflowRun`, `ResumeWorkflowRun`, `ResolveWorkflowQuestion`, `AmendWorkflow`. Their descriptions weigh about 4k tokens and were in every provider request, although most sessions never start a workflow.

## Design

- Runtime field `workflowRunToolsUnlocked` (owner: the `AgentRuntime` instance, not persisted). One-way latch.
- `probeWorkflowRunTools` runs once in `ensureContextInitialized`, before the first `getTools`: `dynamicWorkflowRunPort.listRuns({ cwd, limit: 1 })`; any run in the project unlocks. Missing port or method, or a probe error, counts as no run (logged at warn).
- `filterWorkflowRunScopedTools` is applied in `getTools` after the tool cache, so it is evaluated on every call without invalidating `cachedTools`. It also checks the runtime task registry: a `local_dynamic_workflow` task (a run started in this session) flips the latch, so the next model step sees the four tools. The latch never resets, so a finished run does not make the tools disappear again and the prefix changes at most once per session.
- `CreateWorkflow`, `SaveWorkflow`, `ListSavedWorkflows`, `ListWorkflowRuns`, `EvalWorkflowSnippet`, `WorkflowReference` and `ListModels` stay visible so workflows can still be discovered and started.
- Known limit: runs created by another process in the same project are only seen at the next process start (ponytail comment in the source).

## Measurements

Same plain prompt, `cbai/glm-5.3`, fresh session, first request: 17,325 → 14,200 input tokens. Tool list 27 → 23. Cumulative for this branch on the same model: 23,849 → 14,200 (−40%); on the original `glm-5.3-mod` accounting the starting point was 39,372.

## Testing

`core/test/workflow-run-tools.test.ts`: hidden by default, latch on a registry task, latch persists after the task leaves the registry, probe unlocks on an existing run and stays locked on empty result or missing port. A live headless session confirmed the four tools absent from the request body.

## Not verified in the field

The in-session unlock after `CreateWorkflow` was covered by the unit test only; a real run spawns paid subagents and was not executed.
