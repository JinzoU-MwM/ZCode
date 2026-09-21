// 运行：`cd apps/zcode-cli/packages/bootstrap && node --import tsx --test test/command-inbox.test.ts`（先 `pnpm --filter @zcode/bootstrap build`）。
import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";
import { CommandInbox } from "../dist/zcode-protocol-v4/command-inbox.js";

type Outcome = Awaited<ReturnType<CommandInbox["handle"]>>;

const REVISION = 7;
const LOG_EPOCH = "epoch-1";

function makeInbox(): CommandInbox {
  // 与 v4-gateway.ts 的构造形状一致：已知会话 revision/epoch 固定，未知会话返回 null。
  return new CommandInbox({
    getRevision: (sessionId) => (sessionId.startsWith("s") ? REVISION : null),
    getLogEpoch: (sessionId) => (sessionId.startsWith("s") ? LOG_EPOCH : null),
    validateRowTarget: () => ({ verdict: "allow" }),
    lookupTranscriptCommand: () => null,
    lookupTimelineCommand: () => null,
    lookupChildCommand: () => null,
    lookupDiscardedCommand: () => null,
    now: () => 1_000,
  });
}

function envelope(sessionId: string, commandId: string, extra: Record<string, unknown> = {}) {
  return {
    commandId,
    clientId: "client-1",
    sessionId,
    type: "compact",
    payload: {},
    issuedAt: 1,
    ...extra,
  };
}

function expectExecute(outcome: Outcome): Extract<Outcome, { kind: "execute" }> {
  assert.equal(outcome.kind, "execute");
  return outcome as Extract<Outcome, { kind: "execute" }>;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  await tick();
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
}

test("same session: FIFO admission, increasing admissionSeq, second waits for settle", async () => {
  const inbox = makeInbox();
  const first = expectExecute(await inbox.handle(envelope("s1", "c1")));
  const secondPromise = inbox.handle(envelope("s1", "c2"));

  assert.equal(await isPending(secondPromise), true);
  assert.equal(first.admissionSeq, 1);

  first.settle({ status: "completed" });
  const second = expectExecute(await secondPromise);
  assert.equal(second.admissionSeq, 2);
  assert.ok(second.admittedAt >= first.admittedAt);
  second.settle({ status: "completed" });
});

test("duplicate in flight: both callers share one final result, executed once", async () => {
  const inbox = makeInbox();
  const first = expectExecute(await inbox.handle(envelope("s1", "c1")));
  const retryPromise = inbox.handle(envelope("s1", "c1"));
  assert.equal(await isPending(retryPromise), true);

  first.settle({ status: "completed", result: { type: "compact" } as never });
  const retry = await retryPromise;
  assert.equal(retry.kind, "ack");
  assert.equal(retry.ack.status, "duplicate");
  assert.deepEqual(retry.ack.result, { type: "compact" });
  assert.equal(retry.ack.revisionAtDecision, REVISION);
});

test("failed stays terminal: resubmit after failed does not re-execute", async () => {
  const inbox = makeInbox();
  const first = expectExecute(await inbox.handle(envelope("s1", "c1")));
  first.settle({ status: "failed", reasonCode: "fault.test" });

  const retry = await inbox.handle(envelope("s1", "c1"));
  assert.equal(retry.kind, "ack");
  assert.equal(retry.ack.status, "failed");
  assert.equal(retry.ack.reasonCode, "fault.test");

  const [queried] = await inbox.query([{ sessionId: "s1", commandId: "c1" }]);
  assert.notEqual(queried.result, "unknown");
  assert.equal((queried.result as { status: string }).status, "failed");
});

test("stale baseRevision is rejected without executing and not remembered", async () => {
  const inbox = makeInbox();
  const cas = (commandId: string, baseRevision: number) =>
    envelope("s1", commandId, { type: "setAutoDrain", payload: { autoDrain: true }, baseRevision });

  const stale = await inbox.handle(cas("c1", REVISION - 1));
  assert.equal(stale.kind, "ack");
  assert.equal(stale.ack.status, "stale");
  assert.equal(stale.ack.reasonCode, "proto.staleRevision");
  assert.equal(stale.ack.revisionAtDecision, REVISION);

  // 未 remember，同 commandId 带正确 revision 重发可以正常 admit。
  const fresh = expectExecute(await inbox.handle(cas("c1", REVISION)));
  assert.equal(fresh.admissionSeq, 1);
  fresh.settle({ status: "completed" });

  const [queried] = await inbox.query([{ sessionId: "s1", commandId: "c9" }]);
  assert.equal(queried.result, "unknown");
});

test("in-flight command survives settled-LRU churn; retry still deduplicated", async () => {
  const inbox = makeInbox();
  const cap = PROTOCOL_V4_LIMITS.idempotencyTablePerSession;
  const first = expectExecute(await inbox.handle(envelope("s1", "c1")));

  // 同 session gate 被 c1 持有，只能通过 releaseLiveInput 直接向 settled LRU 灌入终态。
  for (let i = 0; i < cap + 1; i += 1) {
    inbox.releaseLiveInput(
      { sessionId: "s1", commandId: `churn-${i}` },
      { commandId: `churn-${i}`, status: "completed", revisionAtDecision: REVISION },
    );
  }
  const [evicted, kept] = await inbox.query([
    { sessionId: "s1", commandId: "churn-0" },
    { sessionId: "s1", commandId: `churn-${cap}` },
  ]);
  assert.equal(evicted.result, "unknown");
  assert.notEqual(kept.result, "unknown");

  assert.equal(inbox.hasPinnedSessionState("s1"), true);
  const retryPromise = inbox.handle(envelope("s1", "c1"));
  assert.equal(await isPending(retryPromise), true);
  first.settle({ status: "completed" });
  const retry = await retryPromise;
  assert.equal(retry.kind, "ack");
  assert.equal(retry.ack.status, "duplicate");
});

test("different sessions do not block each other", async () => {
  const inbox = makeInbox();
  const a = expectExecute(await inbox.handle(envelope("s1", "c1")));
  const b = expectExecute(await inbox.handle(envelope("s2", "c1")));
  assert.equal(a.admissionSeq, 1);
  assert.equal(b.admissionSeq, 1);
  b.settle({ status: "completed" });
  a.settle({ status: "completed" });
  assert.equal(inbox.clearSession("s1"), true);
  assert.equal(inbox.clearSession("s2"), true);
});
