import {
  AMEND_WORKFLOW_TOOL_NAME,
  GET_WORKFLOW_RUN_TOOL_NAME,
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  type ModelToolContract,
} from "@zcode/contracts";
import { traceContextToLogContext, type TraceContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";

// 只有拿着 runId 才有意义的四个工具（约 4k token 描述）。项目里一条 run 都没有时把它们从
// provider 可见面拿掉：绝大多数会话从不启动工作流，却在每一次 request 的前缀里为它们付费。
// 解锁是**单向闩锁**：一旦项目有 run（启动时探测，或本会话内启动了一条），本进程内始终可见，
// 避免 run 结束后工具又消失、模型正要读结果却找不到工具，也避免前缀反复抖动。
// ponytail: 不监听其他进程在同一项目新建的 run；那种情况下模型要到下一次进程启动才看得到。
export const WORKFLOW_RUN_SCOPED_TOOL_NAMES: ReadonlySet<string> = new Set([
  GET_WORKFLOW_RUN_TOOL_NAME,
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  AMEND_WORKFLOW_TOOL_NAME,
]);

export function filterWorkflowRunScopedTools(
  runtime: Pick<AgentRuntimeInternal, "workflowRunToolsUnlocked" | "runtimeTaskRegistry">,
  tools: readonly ModelToolContract[],
): ModelToolContract[] {
  if (!runtime.workflowRunToolsUnlocked && hasDynamicWorkflowTask(runtime)) {
    // 本会话刚启动了一条 run：从下一次 model step 起解锁。工具面变化会让 provider 前缀
    // 失效一次，这是接受的代价；闩锁保证只发生这一次。
    runtime.workflowRunToolsUnlocked = true;
  }
  if (runtime.workflowRunToolsUnlocked) return [...tools];
  return tools.filter((tool) => !WORKFLOW_RUN_SCOPED_TOOL_NAMES.has(tool.name));
}

/** 首轮 context 初始化时探测：项目已有 run（任何状态）就解锁。端口或方法缺席视为没有。 */
export async function probeWorkflowRunTools(
  runtime: AgentRuntimeInternal,
  traceContext: TraceContext,
): Promise<void> {
  if (runtime.workflowRunToolsUnlocked) return;
  const port = runtime.dynamicWorkflowRunPort;
  if (port === undefined || typeof port.listRuns !== "function") return;
  try {
    const result = await port.listRuns({ cwd: runtime.workingDirectory, limit: 1 });
    if (result.runs.length > 0) runtime.workflowRunToolsUnlocked = true;
  } catch (error) {
    // 探测失败按「没有 run」处理：工具面偏保守，模型仍可通过 CreateWorkflow 触发解锁。
    runtime.logger?.warn("Workflow run probe failed", {
      ...traceContextToLogContext(traceContext),
      error: error instanceof Error ? error.message : String(error),
      event: "workflow.run_tools.probe.failed",
      module: "core.runtime",
      status: "failed",
    });
  }
}

function hasDynamicWorkflowTask(runtime: Pick<AgentRuntimeInternal, "runtimeTaskRegistry">): boolean {
  return Object.values(runtime.runtimeTaskRegistry.all()).some(
    (task) => task.type === "local_dynamic_workflow",
  );
}
