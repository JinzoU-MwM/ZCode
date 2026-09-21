// ============================================================
// WorkflowReference Tool - 按需返回 dynamic-workflow facade 声明与写作规则
// ============================================================
//
// facade 声明（约 5.6k token）加写作规则（约 2.5k token）曾经整段塞在 CreateWorkflow 的
// 描述里，随每一次 provider request 的前缀发送，而绝大多数 turn 根本不写工作流。
// 现在它们只在模型真正要写脚本时通过这个只读工具取一次。

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

export const WORKFLOW_REFERENCE_TOOL_NAME = "WorkflowReference";

export const WorkflowReferenceInputSchema = z.object({}).strict();

export type WorkflowReferenceInput = z.infer<typeof WorkflowReferenceInputSchema>;

export const WorkflowReferenceInputJsonSchema = toToolJsonSchema(WorkflowReferenceInputSchema);

export const WorkflowReferenceOutputSchema = z
  .object({
    reference: z.string(),
  })
  .strict();

export type WorkflowReferenceOutput = z.infer<typeof WorkflowReferenceOutputSchema>;

export const WorkflowReferenceOutputJsonSchema = toToolJsonSchema(WorkflowReferenceOutputSchema);
