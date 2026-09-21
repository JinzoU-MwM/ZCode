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
  // 首轮延迟落库前没有 session 行（SessionStart hook 早于 ensureSessionPersisted）。
  // 先排队，session 行落下后按原顺序补写，仍早于首条 user prompt 的持久化，
  // 因此 DB sequence 与内存历史的顺序一致。
  if (!runtime.sessionPersisted) {
    runtime.pendingRuntimeReminderNotices.push({ source, body, traceContext });
    return;
  }
  await writeRuntimeReminderNotice(runtime, source, body, traceContext);
}

/** ensureSessionPersisted 置位后调用：按入队顺序补写首轮排队的 reminder。 */
export async function flushPendingRuntimeReminderNotices(
  runtime: AgentRuntimeInternal,
): Promise<void> {
  const pending = runtime.pendingRuntimeReminderNotices.splice(0);
  for (const { source, body, traceContext } of pending) {
    await writeRuntimeReminderNotice(runtime, source, body, traceContext);
  }
}

async function writeRuntimeReminderNotice(
  runtime: AgentRuntimeInternal,
  source: SystemReminderSource,
  body: string,
  traceContext: TraceContext,
): Promise<void> {
  await runtime.persistSyntheticUserNoticeForSession({
    messageID: createMessageId(),
    metadata: { runtimeMessage: systemReminderRuntimeMetadata(source) },
    sessionId: runtime.sessionId,
    source: "runtime_reminder",
    text: body,
    traceContext,
  });
}
