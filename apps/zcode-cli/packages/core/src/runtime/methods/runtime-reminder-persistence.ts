import { createMessageId } from "../deps.js";
import type { TraceContext } from "../deps.js";
import { systemReminderRuntimeMetadata } from "../../agent/message-history.js";
import type { SystemReminderSource } from "../../system-reminder/source.js";
import type { AgentRuntimeInternal } from "../internal.js";

// 把只进内存历史的 runtime reminder 同步落成 model-only synthetic notice。
// 原因：这些 reminder 在进程内会一直留在 provider history 里；冷恢复时若缺失，
// 恢复后的第一次请求会从该位置开始与恢复前的 prefix 分叉，prompt cache 整段失效。
// hydrator 通过 part.metadata.runtimeMessage.source 还原为同一 attachment source，
// DB 的 sequence 按写入顺序分配，因此调用方必须在 commit 之后、下一条消息落库之前 await。
export async function persistRuntimeReminderNotice(
  runtime: AgentRuntimeInternal,
  source: SystemReminderSource,
  body: string,
  traceContext: TraceContext,
): Promise<void> {
  // 首轮延迟落库前没有 session 行；此时跳过，等价于旧行为（只影响首轮 SessionStart hook）。
  if (!runtime.sessionPersisted) return;
  await runtime.persistSyntheticUserNoticeForSession({
    messageID: createMessageId(),
    metadata: { runtimeMessage: systemReminderRuntimeMetadata(source) },
    sessionId: runtime.sessionId,
    source: "runtime_reminder",
    text: body,
    traceContext,
  });
}
