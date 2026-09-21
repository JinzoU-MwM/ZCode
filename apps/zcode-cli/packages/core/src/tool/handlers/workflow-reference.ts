// ============================================================
// WorkflowReference Tool Handler
// ============================================================
// 只读、无副作用：返回 dynamic-workflow facade 声明与写作规则。文本与 CreateWorkflow
// 描述过去内嵌的那份逐字相同，只是改为按需取用，不再占每次 provider request 的前缀。

import {
  WORKFLOW_REFERENCE_TOOL_NAME,
  WorkflowReferenceInputJsonSchema,
  WorkflowReferenceInputSchema,
  WorkflowReferenceOutputJsonSchema,
  WorkflowReferenceOutputSchema,
  type ModelMessageContent,
  type WorkflowReferenceOutput,
} from "@zcode/contracts";
import type { ToolEntry, ToolHandler } from "../types.js";
import { WORKFLOW_AUTHORING_REFERENCE } from "./create-workflow-description.js";

const WORKFLOW_REFERENCE_TIMEOUT_MS = 5_000;
// facade + 规则约 30KB；上界留出余量，超出即视为契约被改坏而非静默截断。
const WORKFLOW_REFERENCE_MODEL_BYTES = 64_000;

const WORKFLOW_REFERENCE_DESCRIPTION = [
  "Returns the dynamic-workflow facade declarations (the TypeScript API a workflow script is typechecked against) and the authoring rules: language restrictions, phases, subagent naming.",
  "Call it once per session before writing or revising a script for CreateWorkflow, SaveWorkflow, AmendWorkflow or EvalWorkflowSnippet. Read-only; nothing is executed.",
].join(" ");

const workflowReferenceHandler: ToolHandler = async (input) => {
  WorkflowReferenceInputSchema.parse(input);
  return { reference: WORKFLOW_AUTHORING_REFERENCE } satisfies WorkflowReferenceOutput;
};

function formatWorkflowReferenceModelContent(output: unknown): ModelMessageContent {
  const parsed = WorkflowReferenceOutputSchema.safeParse(output);
  return parsed.success ? parsed.data.reference : "WorkflowReference returned an invalid result.";
}

export const workflowReferenceToolEntry: ToolEntry = {
  capability: "Return the dynamic-workflow facade declarations and authoring rules",
  metadata: {
    name: WORKFLOW_REFERENCE_TOOL_NAME,
    description: WORKFLOW_REFERENCE_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    allowedInPlanMode: true,
    timeoutMs: WORKFLOW_REFERENCE_TIMEOUT_MS,
    maxOutputBytes: WORKFLOW_REFERENCE_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: workflowReferenceHandler,
  inputSchema: WorkflowReferenceInputJsonSchema,
  outputSchema: WorkflowReferenceOutputJsonSchema,
  runtimeInputSchema: WorkflowReferenceInputSchema,
  runtimeOutputSchema: WorkflowReferenceOutputSchema,
  formatModelContent: formatWorkflowReferenceModelContent,
  permission: {
    permission: "workflowReference",
    reason: "WorkflowReference returns static documentation and touches nothing",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: WORKFLOW_REFERENCE_MODEL_BYTES,
    maxModelBytes: WORKFLOW_REFERENCE_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: WORKFLOW_REFERENCE_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    kind: "timed",
    defaultMs: WORKFLOW_REFERENCE_TIMEOUT_MS,
    maxMs: WORKFLOW_REFERENCE_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage: "WorkflowReference returns static text and cannot be cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
