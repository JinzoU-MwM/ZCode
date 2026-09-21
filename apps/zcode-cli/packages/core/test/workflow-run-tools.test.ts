// 运行：先 `pnpm --filter @zcode/core build`，再
// `node --import tsx --test test/workflow-run-tools.test.ts`。
import assert from "node:assert/strict";
import test from "node:test";
import {
  filterWorkflowRunScopedTools,
  probeWorkflowRunTools,
} from "../dist/runtime/methods/workflow-run-tools.js";

const tools = ["Read", "CreateWorkflow", "GetWorkflowRun", "AmendWorkflow", "ListWorkflowRuns"].map(
  (name) => ({ name, inputSchema: {} }),
) as never[];
const names = (list: { name: string }[]) => list.map((tool) => tool.name);
const registry = (types: string[]) => ({
  all: () => Object.fromEntries(types.map((type, index) => [String(index), { type }])),
});

test("run-scoped tools are hidden until the project has a run", () => {
  const runtime = { workflowRunToolsUnlocked: false, runtimeTaskRegistry: registry([]) };
  assert.deepEqual(names(filterWorkflowRunScopedTools(runtime as never, tools)), [
    "Read",
    "CreateWorkflow",
    "ListWorkflowRuns",
  ]);
});

test("a dynamic workflow task in the registry latches the unlock", () => {
  const runtime = {
    workflowRunToolsUnlocked: false,
    runtimeTaskRegistry: registry(["local_bash", "local_dynamic_workflow"]),
  };
  assert.equal(filterWorkflowRunScopedTools(runtime as never, tools).length, tools.length);
  assert.equal(runtime.workflowRunToolsUnlocked, true);
  runtime.runtimeTaskRegistry = registry([]);
  assert.equal(filterWorkflowRunScopedTools(runtime as never, tools).length, tools.length);
});

test("probe unlocks when the port reports an existing run", async () => {
  const seen: unknown[] = [];
  const base = { workflowRunToolsUnlocked: false, workingDirectory: "/p", logger: undefined };
  const withRuns = {
    ...base,
    dynamicWorkflowRunPort: {
      listRuns: async (query: unknown) => (seen.push(query), { runs: [{ runId: "r1" }] }),
    },
  };
  await probeWorkflowRunTools(withRuns as never, { traceId: "t" } as never);
  assert.equal(withRuns.workflowRunToolsUnlocked, true);
  assert.deepEqual(seen, [{ cwd: "/p", limit: 1 }]);

  const empty = { ...base, dynamicWorkflowRunPort: { listRuns: async () => ({ runs: [] }) } };
  await probeWorkflowRunTools(empty as never, { traceId: "t" } as never);
  assert.equal(empty.workflowRunToolsUnlocked, false);

  const noPort = { ...base };
  await probeWorkflowRunTools(noPort as never, { traceId: "t" } as never);
  assert.equal(noPort.workflowRunToolsUnlocked, false);
});
