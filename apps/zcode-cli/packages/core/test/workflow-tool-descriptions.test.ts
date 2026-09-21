// 运行：先 `pnpm --filter @zcode/core build`，再
// `node --import tsx --test test/workflow-tool-descriptions.test.ts`。
import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATE_WORKFLOW_TOOL_DESCRIPTION,
  WORKFLOW_AUTHORING_REFERENCE,
} from "../dist/tool/handlers/create-workflow-description.js";
import { SAVE_WORKFLOW_TOOL_DESCRIPTION } from "../dist/tool/handlers/save-workflow-description.js";
import { EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION } from "../dist/tool/handlers/eval-workflow-snippet-description.js";
import { workflowReferenceToolEntry } from "../dist/tool/handlers/workflow-reference.js";

const FACADE_MARKER = "declare const args";

test("facade declarations live in WorkflowReference only", () => {
  assert.ok(WORKFLOW_AUTHORING_REFERENCE.includes(FACADE_MARKER));
  assert.ok(WORKFLOW_AUTHORING_REFERENCE.includes("Authoring rules:"));
  for (const description of [
    CREATE_WORKFLOW_TOOL_DESCRIPTION,
    SAVE_WORKFLOW_TOOL_DESCRIPTION,
    EVAL_WORKFLOW_SNIPPET_TOOL_DESCRIPTION,
  ]) {
    assert.ok(!description.includes(FACADE_MARKER));
    assert.ok(description.includes("WorkflowReference"));
  }
  assert.ok(CREATE_WORKFLOW_TOOL_DESCRIPTION.length < 5_000);
});

test("WorkflowReference tool returns the reference verbatim", async () => {
  const output = await workflowReferenceToolEntry.handler({}, { workingDirectory: "." } as never);
  assert.equal(workflowReferenceToolEntry.formatModelContent(output), WORKFLOW_AUTHORING_REFERENCE);
});
