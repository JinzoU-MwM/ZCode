import { hash } from "node:crypto";
import type { ModelToolContract } from "@zcode/contracts";
import type { ModelInputMessage, RuntimeMessageEntry } from "../../agent/message-history.js";

// Provider request 前缀指纹：只用来解释 prompt cache miss 发生在哪一条消息、
// 由哪个 runtime source 产生。纯函数，不依赖 provider 或 adapter。
//
// 性能：每次请求对整份 messages 做一次 JSON.stringify + sha256，实测 1.2 MB / 300 条
// 约 1.5 ms，状态只保留每条消息 64 字节 hash。不做 key 排序深拷贝：同一条消息每次
// 请求都由同一 canonical entry 克隆而来，键序稳定，直接序列化即可。
// ponytail: 若未来 context 超过数十 MB 再考虑按 entry 身份缓存 hash。

export interface ProviderRequestFingerprint {
  toolsHash: string;
  messageHashes: readonly string[];
  messageSources: readonly (string | undefined)[];
}

export type PrefixDivergenceKind = "first" | "append" | "diverged" | "shrunk";

export interface PrefixDivergenceReport {
  kind: PrefixDivergenceKind;
  sharedPrefixLength: number;
  previousLength: number;
  nextLength: number;
  toolsChanged: boolean;
  divergedIndex?: number;
  divergedSource?: string;
  divergedRole?: string;
  previousSource?: string;
  /** 唯一变化是上一请求最后一条消息被改写（例如 MCS 合并、tail continuation）。 */
  divergedAtPreviousTail?: boolean;
}

export function fingerprintProviderRequest(input: {
  messages: readonly ModelInputMessage[];
  tools: readonly ModelToolContract[];
  sourceEntries?: readonly (RuntimeMessageEntry | undefined)[];
}): ProviderRequestFingerprint {
  return {
    toolsHash: sha256(
      JSON.stringify(
        input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          strict: tool.strict,
          providerNative: tool.providerNative,
        })),
      ),
    ),
    messageHashes: input.messages.map(hashMessage),
    messageSources: input.messages.map(
      (message, index) => input.sourceEntries?.[index]?.metadata?.source ?? message.role,
    ),
  };
}

export function diffRequestFingerprints(
  previous: ProviderRequestFingerprint | undefined,
  next: ProviderRequestFingerprint,
): PrefixDivergenceReport {
  const nextLength = next.messageHashes.length;
  if (!previous) {
    return {
      kind: "first",
      sharedPrefixLength: 0,
      previousLength: 0,
      nextLength,
      toolsChanged: false,
    };
  }

  const previousLength = previous.messageHashes.length;
  const limit = Math.min(previousLength, nextLength);
  let shared = 0;
  while (shared < limit && previous.messageHashes[shared] === next.messageHashes[shared]) {
    shared++;
  }

  const base = {
    sharedPrefixLength: shared,
    previousLength,
    nextLength,
    toolsChanged: previous.toolsHash !== next.toolsHash,
  };

  if (shared === previousLength) {
    return { kind: "append", ...base };
  }
  if (shared === nextLength) {
    return { kind: "shrunk", ...base };
  }
  return {
    kind: "diverged",
    ...base,
    divergedIndex: shared,
    divergedSource: next.messageSources[shared],
    previousSource: previous.messageSources[shared],
    divergedRole: roleFromSource(next.messageSources[shared]),
    divergedAtPreviousTail: shared === previousLength - 1,
  };
}

function hashMessage(message: ModelInputMessage): string {
  // cacheControl 每次请求都会移动，属于设计内变化，不计入指纹。
  return sha256(
    JSON.stringify({
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      isError: message.isError,
    }),
  );
}

function roleFromSource(source: string | undefined): string | undefined {
  return source === "system" || source === "user" || source === "assistant" || source === "tool"
    ? source
    : undefined;
}

function sha256(text: string): string {
  return hash("sha256", text, "hex");
}
