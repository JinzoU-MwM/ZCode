// 运行：先 `pnpm --filter @zcode/core build`，再
// `node --import tsx --test test/workflow-tool-descriptions.test.ts`。
import assert from "node:assert/strict";
import test from "node:test";
import { CREATE_WORKFLOW_TOOL_DESCRIPTION } from "../dist/tool/handlers/create-workflow-description.js";
import { SAVE_WORKFLOW_TOOL_DESCRIPTION } from "../dist/tool/handlers/save-workflow-description.js";
import { EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION } from "../dist/tool/handlers/eval-workflow-snippet-description.js";

const FACADE_MARKER = "declare const args";

test("facade declarations appear once, in CreateWorkflow only", () => {
  assert.ok(CREATE_WORKFLOW_TOOL_DESCRIPTION.includes(FACADE_MARKER));
  assert.ok(!SAVE_WORKFLOW_TOOL_DESCRIPTION.includes(FACADE_MARKER));
  assert.ok(!EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION.includes(FACADE_MARKER));
  assert.ok(SAVE_WORKFLOW_TOOL_DESCRIPTION.includes("CreateWorkflow tool description"));
  assert.ok(EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION.includes("CreateWorkflow tool description"));
});
