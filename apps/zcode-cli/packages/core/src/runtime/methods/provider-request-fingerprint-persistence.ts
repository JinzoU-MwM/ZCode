import { SESSION_ENTRY_PROVIDER_REQUEST_FINGERPRINT } from "@zcode/contracts";
import { traceContextToLogContext, type TraceContext } from "../deps.js";
import {
  parseProviderRequestFingerprint,
  type ProviderRequestFingerprint,
} from "../helpers/request-prefix-fingerprint.js";
import type { AgentRuntimeInternal } from "../internal.js";

// 前缀指纹只在进程内存里时，冷恢复后的第一个请求永远报 `first`，无法证明恢复前后 prefix 一致。
// 把最近一次指纹以固定 id 写成 session entry（同 id 覆盖，每条消息 64 字节 hash），
// 恢复时读回，diff 就能跨进程给出 append / diverged。纯诊断：任何失败都不影响主流程。
// ponytail: 每次 model step 一次 upsert（几十 KB）；若 context 超大再考虑只写尾部或节流。

export async function persistProviderRequestFingerprint(
  runtime: AgentRuntimeInternal,
  fingerprint: ProviderRequestFingerprint,
  traceContext: TraceContext,
): Promise<void> {
  if (!runtime.sessionPersisted || !runtime.sessionStore?.saveSessionEntry) return;
  const now = Date.now();
  try {
    await runtime.sessionStore.saveSessionEntry({
      id: `${runtime.sessionId}:provider-request-fingerprint`,
      sessionID: runtime.sessionId,
      type: SESSION_ENTRY_PROVIDER_REQUEST_FINGERPRINT,
      touchSession: false,
      time: { created: now, updated: now },
      data: fingerprint,
    });
  } catch (error) {
    runtime.logger?.warn("Provider request fingerprint persistence failed", {
      ...traceContextToLogContext(traceContext),
      error: error instanceof Error ? error.message : String(error),
      event: "model.request.fingerprint.persist.failed",
      module: "core.runtime",
      status: "failed",
    });
  }
}

export async function restoreProviderRequestFingerprint(
  runtime: AgentRuntimeInternal,
): Promise<void> {
  if (!runtime.sessionStore?.sessionEntries) return;
  try {
    const entries = await runtime.sessionStore.sessionEntries({
      sessionID: runtime.sessionId,
      type: SESSION_ENTRY_PROVIDER_REQUEST_FINGERPRINT,
    });
    runtime.lastProviderRequestFingerprint = parseProviderRequestFingerprint(
      entries.at(-1)?.data,
    );
  } catch {
    runtime.lastProviderRequestFingerprint = undefined;
  }
}
