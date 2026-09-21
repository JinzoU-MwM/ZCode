// 运行：先 `pnpm --filter @zcode/core build`，再
// `node --import tsx --test test/compact-policy-selection.test.ts`。
import assert from "node:assert/strict";
import test from "node:test";
import { CompactTrigger } from "@zcode/contracts";
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  getAutoCompactThreshold,
  getEffectiveContextWindowSize,
  shouldAutoCompact,
} from "../dist/compact/policy.js";
import { groupByAssistantStartedRounds } from "../dist/compact/rounds.js";
import {
  estimateRuntimeEntryTokens,
  selectCompactEntries,
  selectCompactEntriesAfterPromptTooLong,
  selectCompactEntriesForInitialPromptTooLong,
} from "../dist/runtime/helpers/compact-selection.js";

// ---------------------------------------------------------------- policy

// estimateMessageTokens = ceil(chars / 3) per message
const CHARS_PER_TOKEN = 3;
const enoughMessages = [
  { role: "user", content: "hi" },
  { role: "assistant", content: "hello" },
  { role: "user", content: "more" },
  { role: "assistant", content: "sure" },
];

test("policy: threshold = (contextWindow - min(maxOutputTokens, 21k)) - 13k buffer", () => {
  // maxOutputTokens below the 21k cap: reserve is maxOutputTokens itself
  const small = { contextWindow: 100_000, maxOutputTokens: 8_000 };
  assert.equal(getEffectiveContextWindowSize(small), 92_000);
  assert.equal(getAutoCompactThreshold(small), 92_000 - AUTOCOMPACT_BUFFER_TOKENS);
  assert.equal(getAutoCompactThreshold(small), 79_000);

  // maxOutputTokens above the cap: reserve is clamped to 21k
  const large = { contextWindow: 100_000, maxOutputTokens: 50_000 };
  assert.equal(getEffectiveContextWindowSize(large), 79_000);
  assert.equal(getAutoCompactThreshold(large), 66_000);

  // no maxOutputTokens: default 32k reserve is also clamped to 21k
  assert.equal(getEffectiveContextWindowSize({ contextWindow: 100_000 }), 79_000);

  const decision = shouldAutoCompact({ messages: enoughMessages, config: small });
  assert.equal(decision.contextWindow, 100_000);
  assert.equal(decision.effectiveContextWindow, 92_000);
  assert.equal(decision.outputReserveTokens, 8_000);
  assert.equal(decision.threshold, 79_000);
  assert.equal(decision.maxOutputTokens, 8_000);
});

test("policy: below vs above threshold from the local estimate", () => {
  const config = { contextWindow: 100_000, maxOutputTokens: 8_000 };
  const threshold = getAutoCompactThreshold(config);

  const below = shouldAutoCompact({ messages: enoughMessages, config });
  assert.equal(below.reason, "below_threshold");
  assert.equal(below.shouldCompact, false);
  assert.equal(below.tokenSource, "estimate");
  assert.equal(below.tokenCount, below.estimatedTokenCount);
  assert.ok(below.tokenCount < threshold);

  // exactly at threshold counts as above (tokenCount < threshold is the only "below" case)
  const atThreshold = [
    ...enoughMessages.slice(0, 3),
    { role: "assistant", content: "x".repeat(threshold * CHARS_PER_TOKEN) },
  ];
  const above = shouldAutoCompact({ messages: atThreshold, config });
  assert.equal(above.reason, "above_threshold");
  assert.equal(above.shouldCompact, true);
  assert.ok(above.tokenCount >= threshold);
});

test("policy: disabled wins over everything; not_enough_messages before threshold", () => {
  const disabled = shouldAutoCompact({ messages: [], config: { enabled: false } });
  assert.equal(disabled.reason, "disabled");
  assert.equal(disabled.shouldCompact, false);

  // only one round, no assistant -> not enough to summarise, even with huge usage
  const single = shouldAutoCompact({
    messages: [{ role: "user", content: "x".repeat(900_000) }],
    tokenOverride: { source: "provider_usage", tokenCount: 10_000_000 },
  });
  assert.equal(single.reason, "not_enough_messages");
  assert.equal(single.shouldCompact, false);

  // two rounds but no assistant message -> still not enough
  const noAssistant = shouldAutoCompact({
    messages: [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ],
  });
  assert.equal(noAssistant.reason, "not_enough_messages");
});

test("policy: circuit breaker trips at 3 consecutive failures", () => {
  assert.equal(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES, 3);
  const config = { contextWindow: 100_000, maxOutputTokens: 8_000 };
  const over = { source: "provider_usage" as const, tokenCount: 1_000_000 };

  for (const failures of [0, 1, 2]) {
    const decision = shouldAutoCompact({
      messages: enoughMessages,
      config,
      consecutiveFailures: failures,
      tokenOverride: over,
    });
    assert.equal(decision.reason, "above_threshold", `failures=${failures}`);
  }
  const tripped = shouldAutoCompact({
    messages: enoughMessages,
    config,
    consecutiveFailures: 3,
    tokenOverride: over,
  });
  assert.equal(tripped.reason, "circuit_breaker");
  assert.equal(tripped.shouldCompact, false);

  // custom limit
  const custom = shouldAutoCompact({
    messages: enoughMessages,
    config: { ...config, maxConsecutiveFailures: 1 },
    consecutiveFailures: 1,
    tokenOverride: over,
  });
  assert.equal(custom.reason, "circuit_breaker");
});

test("policy: provider usage override replaces the local estimate", () => {
  const config = { contextWindow: 100_000, maxOutputTokens: 8_000 };
  const threshold = getAutoCompactThreshold(config);

  // tiny messages, provider says we are over
  const providerOver = shouldAutoCompact({
    messages: enoughMessages,
    config,
    tokenOverride: {
      source: "provider_usage",
      tokenCount: threshold,
      cacheReadTokens: 1_234,
      contextUsageTokenCount: threshold,
    },
  });
  assert.equal(providerOver.reason, "above_threshold");
  assert.equal(providerOver.tokenSource, "provider_usage");
  assert.equal(providerOver.tokenCount, threshold);
  assert.ok(providerOver.estimatedTokenCount < threshold, "estimate still reported separately");
  assert.equal(providerOver.providerCacheReadTokens, 1_234);
  assert.equal(providerOver.providerContextUsageTokenCount, threshold);

  // huge messages, provider says we are under
  const huge = [
    ...enoughMessages.slice(0, 3),
    { role: "assistant", content: "x".repeat(threshold * CHARS_PER_TOKEN * 2) },
  ];
  const providerUnder = shouldAutoCompact({
    messages: huge,
    config,
    tokenOverride: { source: "provider_usage", tokenCount: 10 },
  });
  assert.equal(providerUnder.reason, "below_threshold");
  assert.equal(providerUnder.tokenCount, 10);
  assert.ok(providerUnder.estimatedTokenCount >= threshold);
});

// ------------------------------------------------------------- selection

type Entry = Parameters<typeof selectCompactEntries>[0]["entries"][number];

// cloneRuntimeMessageEntry emits an explicit `metadata: undefined`; mirror it so deep-equal holds
const sys = (content: string): Entry => ({ message: { role: "system", content }, metadata: undefined });
const attachment = (source: string, content: string): Entry =>
  ({ kind: "attachment", content, cacheControl: undefined, metadata: { source } }) as Entry;
const user = (content: string): Entry => ({
  message: { role: "user", content },
  metadata: { source: "real_user" },
});
const assistant = (content: string, id?: string): Entry => ({
  message: {
    role: "assistant",
    content,
    ...(id ? { toolCalls: [{ id, name: "Read", input: { path: content } }] } : {}),
  },
  metadata: undefined,
});
const toolResult = (id: string, content: string): Entry => ({
  message: { role: "tool", content, toolCallId: id, toolName: "Read" },
  metadata: undefined,
});

const roleOf = (entry: Entry) => ("kind" in entry && entry.kind === "attachment" ? "user" : entry.message.role);

const prefix: Entry[] = [
  sys("system prompt"),
  attachment("context_prefix", "<workspace context>"),
  attachment("skills_listing", "<skills>"),
];

/** Rounds: [u1] [a1 t1] [a2 t2 todo-attachment u2] [a3 t3] [a4] [a5 t5] */
function buildBody(pad = ""): Entry[] {
  return [
    user("u1" + pad),
    assistant("a1" + pad, "c1"),
    toolResult("c1", "t1" + pad),
    assistant("a2" + pad, "c2"),
    toolResult("c2", "t2" + pad),
    attachment("todo_reminder", "<todo>" + pad),
    user("u2" + pad),
    assistant("a3" + pad, "c3"),
    toolResult("c3", "t3" + pad),
    assistant("a4" + pad),
    assistant("a5" + pad, "c5"),
    toolResult("c5", "t5" + pad),
  ];
}
const body = buildBody();
const rounds = groupByAssistantStartedRounds(body, roleOf);

test("rounds: body splits into assistant-started rounds; leading user is its own round", () => {
  assert.equal(rounds.length, 6);
  assert.deepEqual(
    rounds.map((round) => round.length),
    [1, 2, 4, 2, 1, 2],
  );
  for (const round of rounds.slice(1)) assert.equal(roleOf(round[0]!), "assistant");
});

test("selectCompactEntries: prefix untouched, newest N rounds verbatim, rest summarised, no split", () => {
  const entries = [...prefix, ...body];
  for (const n of [1, 2, 3]) {
    const selection = selectCompactEntries({
      entries,
      minimumGroupsToPreserve: n,
      trigger: CompactTrigger.Auto,
    });
    assert.equal(selection.totalGroups, rounds.length);
    assert.equal(selection.groupsPreserved, n);

    // prefix sits verbatim at the head of entriesForSummary and never in preserved
    assert.deepEqual(selection.entriesForSummary.slice(0, prefix.length), prefix);
    assert.deepEqual(selection.preservedEntries, rounds.slice(-n).flat());
    assert.deepEqual(selection.entriesForSummary.slice(prefix.length), rounds.slice(0, -n).flat());

    // no entry lost or duplicated; preserved tail starts on an assistant
    assert.deepEqual(
      [...selection.entriesForSummary.slice(prefix.length), ...selection.preservedEntries],
      body,
    );
    assert.equal(roleOf(selection.preservedEntries[0]!), "assistant");
  }
});

test("selectCompactEntries: default preserves 1 round on Auto/Reactive, 0 on Manual; cap at total-1", () => {
  const entries = [...prefix, ...body];
  for (const trigger of [CompactTrigger.Auto, CompactTrigger.Reactive]) {
    const selection = selectCompactEntries({ entries, trigger });
    assert.equal(selection.groupsPreserved, 1, trigger);
    assert.deepEqual(selection.preservedEntries, rounds.at(-1));
  }
  const manual = selectCompactEntries({ entries, minimumGroupsToPreserve: 3, trigger: CompactTrigger.Manual });
  assert.equal(manual.groupsPreserved, 0);
  assert.deepEqual(manual.preservedEntries, []);
  assert.deepEqual(manual.entriesForSummary, entries);

  const capped = selectCompactEntries({ entries, minimumGroupsToPreserve: 99, trigger: CompactTrigger.Auto });
  assert.equal(capped.groupsPreserved, rounds.length - 1);
  assert.deepEqual(capped.entriesForSummary.slice(prefix.length), rounds[0]);
});

test("selectCompactEntries: results are clones, input is not mutated", () => {
  const entries = [...prefix, ...body];
  const snapshot = structuredClone(entries);
  const selection = selectCompactEntries({ entries, trigger: CompactTrigger.Auto });
  (selection.preservedEntries[0] as { message: { content: string } }).message.content = "mutated";
  (selection.entriesForSummary[0] as { message: { content: string } }).message.content = "mutated";
  assert.deepEqual(entries, snapshot);
});

test("selectCompactEntriesAfterPromptTooLong: each retry preserves strictly more rounds (summarises fewer)", () => {
  const entries = [...prefix, ...body];
  let current = 1;
  const seen: number[] = [];
  for (;;) {
    const next = selectCompactEntriesAfterPromptTooLong({
      entries,
      promptTooLongCause: new Error("prompt too long"), // no token gap -> move 1 round per retry
      trigger: CompactTrigger.Auto,
      currentGroupsPreserved: current,
    });
    if (!next) break;
    assert.ok(next.groupsPreserved > current, `${next.groupsPreserved} > ${current}`);
    assert.equal(next.groupsPreserved, current + 1);
    assert.deepEqual(next.preservedEntries, rounds.slice(-next.groupsPreserved).flat());
    seen.push(next.groupsPreserved);
    current = next.groupsPreserved;
  }
  // stops once fewer than 2 rounds would remain for summary
  assert.deepEqual(seen, [2, 3, 4]);
  assert.equal(
    selectCompactEntriesAfterPromptTooLong({
      entries,
      promptTooLongCause: {},
      trigger: CompactTrigger.Auto,
      currentGroupsPreserved: rounds.length - 1,
    }),
    null,
  );
  assert.equal(
    selectCompactEntriesAfterPromptTooLong({
      entries,
      promptTooLongCause: {},
      trigger: CompactTrigger.Manual,
      currentGroupsPreserved: 0,
    }),
    null,
  );
});

test("selectCompactEntriesAfterPromptTooLong: token gap in cause widens the tail by enough rounds", () => {
  const padded = buildBody("x".repeat(3_000));
  const entries = [...prefix, ...padded];
  const paddedRounds = groupByAssistantStartedRounds(padded, roleOf);
  const tokensOf = paddedRounds.map((round) => estimateRuntimeEntryTokens(round));
  const current = 1;
  // gap that needs the last two summarised rounds (indices 3 and 4 of the 5 summarised)
  const gap = tokensOf[4]! + 1;
  const next = selectCompactEntriesAfterPromptTooLong({
    entries,
    promptTooLongCause: { cause: { message: `prompt is too long: ${20_000 + gap} tokens > 20000 maximum` } },
    trigger: CompactTrigger.Auto,
    currentGroupsPreserved: current,
  });
  assert.ok(next);
  assert.equal(next.groupsPreserved, current + 2);
  assert.ok(estimateRuntimeEntryTokens(next.preservedEntries.slice(0, -1)) >= gap);
});

test("selectCompactEntriesForInitialPromptTooLong: preserves enough newest rounds to cover the gap", () => {
  const padded = buildBody("x".repeat(3_000));
  const entries = [...prefix, ...padded];
  const paddedRounds = groupByAssistantStartedRounds(padded, roleOf);
  const tokensOf = paddedRounds.map((round) => estimateRuntimeEntryTokens(round));

  // last round is already preserved; need two more to cover the remainder
  const gap = tokensOf[5]! + tokensOf[4]! + 1;
  const cause = { message: `input length: ${100_000 + gap} tokens > 100,000 maximum` };
  const selection = selectCompactEntriesForInitialPromptTooLong({
    entries,
    promptTooLongCause: cause,
    trigger: CompactTrigger.Auto,
  });
  assert.ok(selection);
  assert.equal(selection.groupsPreserved, 3);
  assert.deepEqual(selection.preservedEntries, paddedRounds.slice(-3).flat());
  assert.ok(estimateRuntimeEntryTokens(selection.preservedEntries) >= gap);
  assert.deepEqual(selection.entriesForSummary.slice(0, prefix.length), prefix);

  // gap already covered by the last round -> nothing to do
  assert.equal(
    selectCompactEntriesForInitialPromptTooLong({
      entries,
      promptTooLongCause: { message: `${100_000 + Math.floor(tokensOf[5]! / 2)} tokens > 100000` },
      trigger: CompactTrigger.Auto,
    }),
    null,
  );
  // no parsable gap -> null
  assert.equal(
    selectCompactEntriesForInitialPromptTooLong({
      entries,
      promptTooLongCause: new Error("prompt too long"),
      trigger: CompactTrigger.Auto,
    }),
    null,
  );
  // too few rounds (<= 3) -> null
  assert.equal(
    selectCompactEntriesForInitialPromptTooLong({
      entries: [...prefix, ...padded.slice(0, 5)],
      promptTooLongCause: cause,
      trigger: CompactTrigger.Auto,
    }),
    null,
  );
});

test("selectCompactEntriesForInitialPromptTooLong: a gap needing nearly every round falls back to half", () => {
  // countRecentGroupsToCoverTokenGap: when covering the gap would consume all but one candidate
  // round it returns floor(candidates / 2) instead, so something is still left to summarise.
  const padded = buildBody("x".repeat(3_000));
  const entries = [...prefix, ...padded];
  const huge = { message: "9,000,000 tokens > 100,000" };
  const selection = selectCompactEntriesForInitialPromptTooLong({
    entries,
    promptTooLongCause: huge,
    trigger: CompactTrigger.Auto,
  });
  assert.ok(selection);
  // 5 candidate rounds (all but the last) -> floor(5/2) = 2 extra, plus the last one
  assert.equal(selection.groupsPreserved, 3);
  assert.ok(selection.entriesForSummary.length > prefix.length);
});
