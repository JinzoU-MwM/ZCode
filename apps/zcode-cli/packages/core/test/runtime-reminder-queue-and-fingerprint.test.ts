// 运行：先 `pnpm --filter @zcode/core build`，再 `pnpm test`。
import assert from "node:assert/strict";
import test from "node:test";
import {
  flushPendingRuntimeReminderNotices,
  persistRuntimeReminderNotice,
} from "../dist/runtime/methods/runtime-reminder-persistence.js";
import {
  persistProviderRequestFingerprint,
  restoreProviderRequestFingerprint,
} from "../dist/runtime/methods/provider-request-fingerprint-persistence.js";
import {
  diffRequestFingerprints,
  parseProviderRequestFingerprint,
} from "../dist/runtime/helpers/request-prefix-fingerprint.js";

const trace = { traceId: "t" } as never;

test("reminders before the session row exists are queued and flushed in order", async () => {
  const written: string[] = [];
  const runtime = {
    sessionId: "sess_x",
    sessionPersisted: false,
    pendingRuntimeReminderNotices: [],
    persistSyntheticUserNoticeForSession: async (o: { text: string }) => {
      written.push(o.text);
    },
  };
  await persistRuntimeReminderNotice(runtime as never, "hook_context", "hook A", trace);
  await persistRuntimeReminderNotice(runtime as never, "output_style", "style", trace);
  assert.deepEqual(written, []);
  assert.equal(runtime.pendingRuntimeReminderNotices.length, 2);

  runtime.sessionPersisted = true;
  await flushPendingRuntimeReminderNotices(runtime as never);
  assert.deepEqual(written, ["hook A", "style"]);
  assert.equal(runtime.pendingRuntimeReminderNotices.length, 0);

  await persistRuntimeReminderNotice(runtime as never, "runtime_mode", "plan", trace);
  assert.deepEqual(written, ["hook A", "style", "plan"]);
});

test("fingerprint round-trips through the session store and resumes as append", async () => {
  const entries: Array<{ id: string; type: string; data: unknown }> = [];
  const store = {
    saveSessionEntry: async (e: { id: string; type: string; data: unknown }) => {
      const i = entries.findIndex((x) => x.id === e.id);
      if (i >= 0) entries[i] = e;
      else entries.push(e);
    },
    sessionEntries: async (q: { type?: string }) => entries.filter((e) => e.type === q.type),
  };
  const fp = {
    toolsHash: "abc",
    messageHashes: ["h1", "h2"],
    messageSources: ["system", "real_user"],
  };
  const writer = { sessionId: "sess_x", sessionPersisted: true, sessionStore: store };
  await persistProviderRequestFingerprint(writer as never, fp, trace);
  await persistProviderRequestFingerprint(writer as never, { ...fp, messageHashes: ["h1", "h2", "h3"], messageSources: ["system", "real_user", "assistant"] }, trace);
  assert.equal(entries.length, 1, "same id overwrites");

  const reader: { sessionId: string; sessionStore: typeof store; lastProviderRequestFingerprint?: unknown } = {
    sessionId: "sess_x",
    sessionStore: store,
  };
  await restoreProviderRequestFingerprint(reader as never);
  const restored = reader.lastProviderRequestFingerprint as { messageHashes: string[] };
  assert.deepEqual(restored.messageHashes, ["h1", "h2", "h3"]);

  const next = { toolsHash: "abc", messageHashes: ["h1", "h2", "h3", "h4"], messageSources: ["system", "real_user", "assistant", "real_user"] };
  assert.equal(diffRequestFingerprints(restored as never, next).kind, "append");
});

test("malformed persisted fingerprints are ignored", () => {
  assert.equal(parseProviderRequestFingerprint(null), undefined);
  assert.equal(parseProviderRequestFingerprint({ toolsHash: 1 }), undefined);
  assert.equal(
    parseProviderRequestFingerprint({ toolsHash: "a", messageHashes: ["x"], messageSources: [] }),
    undefined,
  );
  assert.deepEqual(
    parseProviderRequestFingerprint({ toolsHash: "a", messageHashes: ["x"], messageSources: [null] }),
    { toolsHash: "a", messageHashes: ["x"], messageSources: [undefined] },
  );
});
