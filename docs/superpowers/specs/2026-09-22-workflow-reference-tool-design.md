# WorkflowReference: load the workflow facade on demand

Date: 2026-09-22
Module: `zcode-cli` (`contracts/src/tools`, `core/src/tool/handlers`)

## Problem

After deduplicating the facade (see `2026-09-21-workflow-tool-description-dedupe-design.md`) the `CreateWorkflow` description still carried ~8k tokens on every provider request: the facade declarations (~5.6k) plus the authoring rules, phase guidance and naming rules (~2.5k). Almost no turn writes a workflow, yet every turn paid for the text, and every prompt-cache miss re-read it.

## Design

- New read-only tool `WorkflowReference` (`contracts/src/tools/workflow-reference.ts`, `core/src/tool/handlers/workflow-reference.ts`). Empty input; returns `WORKFLOW_AUTHORING_REFERENCE`, which is the exact text the `CreateWorkflow` description used to embed (facade block, authoring rules, phases, subagent names). Exported from `create-workflow-description.ts` so there is one source.
- `CreateWorkflow` description keeps intro, sources and when-to-use, and ends with a pointer: call `WorkflowReference` once per session before writing or revising a script. `SaveWorkflow` and `EvalWorkflowSnippet` point at the same tool.
- Compile failures append one line telling the model to call `WorkflowReference` if a name or rule is unclear, so a script written blind self-corrects in one extra roundtrip.
- The tool joins `DYNAMIC_WORKFLOW_TOOL_NAMES`, so the desktop gray-release gate removes it together with the other workflow tools. Permission: always allowed, no approval, `sideEffectScope: "none"`.

## Measurements

Same headless prompt, `cbai/glm-5.3` through the user's OpenAI-compatible endpoint, fresh session, first request:

| state                                    | input tokens |
| ---------------------------------------- | ------------ |
| before dedupe (glm-5.3-mod tokenizer)    | 39,372       |
| after dedupe (glm-5.3-mod tokenizer)     | 32,762       |
| after dedupe (`cbai/glm-5.3`)            | 23,849       |
| after WorkflowReference (`cbai/glm-5.3`) | 17,325       |

A prompt that required `EvalWorkflowSnippet` made the model call `WorkflowReference` first (second request grew by ~6.2k tokens), then compiled and ran the snippet correctly.

## Testing

`core/test/workflow-tool-descriptions.test.ts`: facade marker only in the reference text, all three descriptions mention `WorkflowReference`, `CreateWorkflow` description under 5k characters, and the tool handler returns the reference verbatim.

## Trade-off

Workflow authoring now costs one extra tool roundtrip per session. Every other turn saves ~8k tokens of prefix.
