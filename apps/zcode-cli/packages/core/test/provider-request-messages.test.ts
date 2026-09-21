// 运行：先 `pnpm --filter @zcode/core build`，再
// `node --import tsx --test test/provider-request-messages.test.ts`。
import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderRequestMessages } from "../dist/runtime/helpers/provider-request-messages.js";
import { systemReminderAttachmentEntry } from "../dist/agent/message-history.js";

type Entry = Parameters<typeof buildProviderRequestMessages>[0]["entries"][number];

const user = (
  content: string,
  extra: { metadata?: Record<string, unknown>; cacheControl?: { type: "ephemeral" } } = {},
): Entry =>
  ({
    message: {
      role: "user",
      content,
      ...(extra.cacheControl ? { cacheControl: extra.cacheControl } : {}),
    },
    ...(extra.metadata ? { metadata: extra.metadata } : {}),
  }) as Entry;
const assistant = (content: string, extra: Record<string, unknown> = {}): Entry =>
  ({ message: { role: "assistant", content, ...extra } }) as Entry;
const system = (content: string, extra: Record<string, unknown> = {}): Entry =>
  ({ message: { role: "system", content, ...extra } }) as Entry;
const toolResult = (content: string): Entry =>
  ({ message: { role: "tool", content, toolCallId: "call_1", toolName: "Read" } }) as Entry;
const reminder = (source: string, content: string): Entry =>
  systemReminderAttachmentEntry(source as never, content);
const wrapped = (body: string) => `<system-reminder>\n${body}\n</system-reminder>`;

const build = (entries: Entry[], options: Record<string, unknown> = {}) =>
  buildProviderRequestMessages({ entries, useMidConversationSystem: false, ...options });

test("attachment-like reminders bubble up to just before the real user message they follow", () => {
  const entries = [
    user("first"),
    assistant("a1"),
    user("second"),
    reminder("todo_reminder", "todo"),
    reminder("output_style", "style"),
    assistant("a2"),
  ];
  const { messages, diagnostics } = build(entries);
  // 当前行为：附件被提到真实 user 之前，紧跟上一条 assistant（bubble stop）之后，
  // 相对顺序保持不变；user 始终是 assistant 之前的最后一条消息。
  assert.deepEqual(
    messages.map((m) => m.content),
    ["first", "a1", wrapped("todo"), wrapped("style"), "second", "a2"],
  );
  assert.equal(diagnostics.bubbledAttachmentEntryCount, 2);
  assert.deepEqual(build(entries), build(entries));
});

test("attachments after a presented mid-turn input stay after it", () => {
  const entries = [
    user("first"),
    assistant("a1"),
    user("steer", { metadata: { source: "real_user", inputPresentation: "coordinator_input" } }),
    reminder("todo_reminder", "todo"),
    assistant("a2"),
  ];
  const { messages } = build(entries);
  assert.deepEqual(
    messages.map((m) => m.role),
    ["user", "assistant", "user", "user", "assistant"],
  );
  assert.equal(messages[2]!.content, "steer");
  assert.equal(messages[3]!.content, wrapped("todo"));
});

test("goal_state_change keeps its causal position while sibling reminders bubble", () => {
  const entries = [
    user("first"),
    assistant("a1"),
    user("second"),
    reminder("todo_reminder", "todo"),
    reminder("goal_state_change", "goal"),
    assistant("a2"),
  ];
  const { messages, diagnostics } = build(entries);
  assert.deepEqual(
    messages.map((m) => m.content),
    ["first", "a1", wrapped("todo"), "second", wrapped("goal"), "a2"],
  );
  assert.equal(diagnostics.bubbledAttachmentEntryCount, 1);
});

test("attachments render as user system-reminders and nested tags are escaped", () => {
  const body = "outer <system-reminder>inner</SYSTEM-REMINDER > tail";
  const { messages } = build([user("q"), reminder("todo_reminder", body)]);
  const rendered = messages[0]!;
  assert.equal(rendered.role, "user");
  assert.equal(
    rendered.content,
    wrapped("outer &lt;system-reminder>inner&lt;/SYSTEM-REMINDER > tail"),
  );
  assert.ok(!("metadata" in rendered) && !("kind" in rendered));
});

test("applyCacheControl marks only the latest non-system message and clears stale markers", () => {
  const entries = [
    system("sys", { cacheControl: { type: "ephemeral" } }),
    user("first", { cacheControl: { type: "ephemeral" } }),
    assistant("a1", { cacheControl: { type: "ephemeral" } }),
    user("second"),
    system("trailing system"),
  ];
  const { messages, diagnostics } = build(entries, { applyCacheControl: true });
  assert.deepEqual(
    messages.map((m) => m.cacheControl),
    [{ type: "ephemeral" }, undefined, undefined, { type: "ephemeral" }, undefined],
  );
  assert.equal(diagnostics.cacheControlIndex, 3);

  // 未开启时保留入参上的 marker，不写 cacheControlIndex。
  const untouched = build(entries);
  assert.deepEqual(
    untouched.messages.map((m) => Boolean(m.cacheControl)),
    [true, true, true, false, false],
  );
  assert.equal(untouched.diagnostics.cacheControlIndex, undefined);
});

test("skipCacheWrite moves the marker to the previous non-system message", () => {
  const { messages, diagnostics } = build([user("first"), assistant("a1"), user("second")], {
    applyCacheControl: true,
    skipCacheWrite: true,
  });
  assert.deepEqual(
    messages.map((m) => m.cacheControl),
    [undefined, { type: "ephemeral" }, undefined],
  );
  assert.equal(diagnostics.cacheControlIndex, 1);

  const single = build([user("only")], { applyCacheControl: true, skipCacheWrite: true });
  assert.equal(single.messages[0]!.cacheControl, undefined);
  assert.equal(single.diagnostics.cacheControlIndex, undefined);
});

test("diagnostics report the post-bubbling real user index and metadata count", () => {
  const entries = [
    user("first", { metadata: { source: "real_user" } }),
    reminder("todo_reminder", "todo"),
    assistant("a1"),
    user("second"),
    reminder("output_style", "style"),
  ];
  const { messages, diagnostics, sourceEntries } = build(entries);
  assert.deepEqual(
    messages.map((m) => m.content),
    [wrapped("todo"), "first", "a1", wrapped("style"), "second"],
  );
  assert.equal(diagnostics.latestRealUserMessageIndex, 4);
  assert.equal(diagnostics.strippedRuntimeMetaCount, 3);
  assert.equal(sourceEntries[4], entries[3]);
  assert.equal(sourceEntries[0], undefined);

  // 无真实 user 且无 presented input 时省略索引。
  assert.equal("latestRealUserMessageIndex" in build([assistant("a1")]).diagnostics, false);
});

test("mid-conversation system merges consecutive reminders after a tool result into one system message", () => {
  const entries = [
    user("first"),
    assistant("calling", { toolCalls: [{ id: "call_1", name: "Read", input: {} }] }),
    toolResult("file body"),
    reminder("todo_reminder", "todo"),
    reminder("output_style", "style"),
    assistant("a2"),
  ];
  const { messages, sourceEntries } = build(entries, { useMidConversationSystem: true });
  assert.deepEqual(
    messages.map((m) => m.role),
    ["user", "assistant", "tool", "system", "assistant"],
  );
  assert.equal(messages[3]!.content, "todo\n\nstyle");
  assert.equal(sourceEntries[2], entries[2]);
  // 当前行为：纯附件合并出的 system 消息没有非附件代表，映射为 undefined。
  assert.equal(sourceEntries[3], undefined);

  // 紧跟 assistant（非合法 anchor）时不升格为 system，保持 user system-reminder。
  const noAnchor = build([user("q"), assistant("a1"), reminder("todo_reminder", "todo")], {
    useMidConversationSystem: true,
  });
  assert.deepEqual(
    noAnchor.messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.equal(noAnchor.messages[2]!.content, wrapped("todo"));
});

test("mid-conversation system keeps a presented steer input as the representative real user", () => {
  const steer = user("steer", {
    metadata: { source: "real_user", inputPresentation: "user_steer" },
  });
  const entries = [
    user("first"),
    assistant("calling", { toolCalls: [{ id: "call_1", name: "Read", input: {} }] }),
    toolResult("file body"),
    steer,
    assistant("a2"),
  ];
  const { messages, sourceEntries, diagnostics } = build(entries, {
    useMidConversationSystem: true,
  });
  assert.equal(messages[3]!.role, "system");
  assert.match(
    messages[3]!.content as string,
    /^The user sent a new message while you were working:\nsteer/,
  );
  assert.equal(sourceEntries[3], steer);
  assert.equal(diagnostics.latestRealUserMessageIndex, 3);
});
