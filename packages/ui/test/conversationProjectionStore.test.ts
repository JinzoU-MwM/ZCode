// ConversationProjectionStore 的三条不变量（见源码头注释）：
//   1. snapshot 整体替换，绝不 merge；
//   2. delta 只在 frame.fromSeq === snapshot.seq 时 apply，断档不猜、不缓存，转 resync；
//   3. 断档时状态未被污染，携当前水位重订阅。
// 另覆盖 optimistic overlay 的登记/对账与 useSyncExternalStore listener 通知边界。
import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConversationDelta,
  ConversationResyncParams,
  ConversationRow,
  ConversationSnapshot,
  ConversationTopicFrame,
} from "../../shared/src/zcode-protocol-v4/index.js";
import { ConversationProjectionStore } from "../src/v4/conversationProjectionStore.js";
import type { ConversationTransport } from "../src/v4/transport.js";

const TOPIC = "conversation/s1";
const SUB = "sub-1";
const EPOCH = "epoch-1";

function row(rowId: number, sourceCommandId?: string): ConversationRow {
  return {
    rowId,
    turnId: "t1",
    kind: "userInput",
    origin: "realUser",
    text: `row ${rowId}`,
    sourceCommandId,
  } as unknown as ConversationRow;
}

// 只填 store 运行时真正读取的字段；协议其余字段与本不变量无关。
function snapshot(seq: number, rows: ConversationRow[]): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "s1",
    logEpoch: EPOCH,
    seq,
    revision: seq,
    queue: { items: [], autoDrain: true },
    pendingCommands: [],
    backgroundWorks: [],
    modelTransition: null,
    rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
  } as unknown as ConversationSnapshot;
}

function snapshotFrame(snap: ConversationSnapshot): ConversationTopicFrame {
  return {
    topic: TOPIC,
    subscriptionId: SUB,
    fromSeq: 0,
    toSeq: snap.seq,
    sentAt: 0,
    payload: { kind: "snapshot", snapshot: snap },
  } as ConversationTopicFrame;
}

function deltaFrame(
  fromSeq: number,
  toSeq: number,
  deltas: ConversationDelta[],
  subscriptionId = SUB,
): ConversationTopicFrame {
  return {
    topic: TOPIC,
    subscriptionId,
    fromSeq,
    toSeq,
    sentAt: 0,
    payload: { kind: "deltas", deltas },
  } as ConversationTopicFrame;
}

/** 连上并 apply 首个 snapshot（seq=5，含 row 1），返回 live store 与观测句柄。 */
async function liveStore(t: test.TestContext) {
  const resyncCalls: ConversationResyncParams[] = [];
  const transport = {
    subscribe: async () => ({ ack: { subscriptionId: SUB, mode: "snapshot", logEpoch: EPOCH } }),
    activate() {},
    resync(params: ConversationResyncParams) {
      resyncCalls.push(params);
      return new Promise(() => {}); // 不结算：只观察 store 是否发起 resync
    },
    unsubscribe: async () => {},
    onFrame: () => () => {},
    onAssemblyFault: () => () => {},
    onRuntimeRestart: () => () => {},
  } as unknown as ConversationTransport;
  const store = new ConversationProjectionStore(TOPIC, transport);
  t.after(() => store.close());
  await store.connect();
  store.handleFrame(snapshotFrame(snapshot(5, [row(1)])), { deliveryKind: "initial" });
  assert.equal(store.getState().status, "live");
  assert.equal(store.getState().snapshot?.seq, 5);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  return { store, resyncCalls, notified: () => notifications };
}

test("snapshot replaces prior state wholesale (rule 1)", async (t) => {
  const { store } = await liveStore(t);
  const next = snapshot(9, [row(10)]);
  store.handleFrame(snapshotFrame(next));
  const state = store.getState();
  assert.equal(state.snapshot, next); // 同一引用，未 merge
  assert.deepEqual(
    state.snapshot?.rows.window.map((r) => r.rowId),
    [10],
  );
});

test("contiguous delta (fromSeq === seq) applies and advances seq (rule 2)", async (t) => {
  const { store, notified } = await liveStore(t);
  store.handleFrame(deltaFrame(5, 6, [{ op: "row.appended", row: row(2) }]));
  const snap = store.getState().snapshot;
  assert.equal(snap?.seq, 6);
  assert.deepEqual(
    snap?.rows.window.map((r) => r.rowId),
    [1, 2],
  );
  assert.equal(notified(), 1);
});

test("gap delta (fromSeq > seq) is not applied, not buffered; store resyncs with current watermark", async (t) => {
  const { store, resyncCalls, notified } = await liveStore(t);
  const before = store.getState().snapshot;
  store.handleFrame(deltaFrame(7, 8, [{ op: "row.appended", row: row(3) }]));
  assert.equal(store.getState().snapshot, before); // 状态未被污染
  assert.equal(store.getState().status, "live");
  assert.equal(resyncCalls.length, 1);
  assert.deepEqual(resyncCalls[0], { subscriptionId: SUB, base: { logEpoch: EPOCH, seq: 5 } });
  assert.equal(notified(), 0);
  // 桥接帧迟到也不会拼上去：断档后 online 帧一律等 recovery 裁决，绝不本地补偿。
  store.handleFrame(deltaFrame(5, 7, [{ op: "row.appended", row: row(2) }]));
  assert.equal(store.getState().snapshot, before);
  assert.equal(resyncCalls.length, 1);
  assert.equal(notified(), 0);
});

test("stale delta (toSeq <= seq) is silently ignored", async (t) => {
  const { store, resyncCalls, notified } = await liveStore(t);
  const before = store.getState().snapshot;
  store.handleFrame(deltaFrame(3, 5, [{ op: "row.appended", row: row(99) }]));
  store.handleFrame(deltaFrame(4, 4, [{ op: "row.appended", row: row(98) }]));
  assert.equal(store.getState().snapshot, before);
  assert.equal(resyncCalls.length, 0);
  assert.equal(notified(), 0);
});

test("markCommandPending adds overlay; snapshot carrying the command reconciles it away", async (t) => {
  const { store } = await liveStore(t);
  store.markCommandPending({ commandId: "c1", type: "sendText", issuedAt: 1 });
  assert.deepEqual(
    store.getState().optimisticCommands.map((c) => c.commandId),
    ["c1"],
  );
  // 未确认该命令的 snapshot 不会误清 overlay。
  store.handleFrame(snapshotFrame(snapshot(6, [row(1)])));
  assert.equal(store.getState().optimisticCommands.length, 1);
  // 权威投影出现同 commandId 的 realUser userInput → overlay 退场。
  store.handleFrame(snapshotFrame(snapshot(7, [row(1), row(2, "c1")])));
  assert.deepEqual(store.getState().optimisticCommands, []);
});

test("listeners notified on applied frames only", async (t) => {
  const { store, notified } = await liveStore(t);
  store.handleFrame(snapshotFrame(snapshot(6, [row(1)])));
  assert.equal(notified(), 1);
  store.handleFrame(deltaFrame(6, 7, [{ op: "row.appended", row: row(2) }]));
  assert.equal(notified(), 2);
  // 忽略路径：过期帧、旧代际 subscriptionId 的帧。
  store.handleFrame(deltaFrame(2, 3, [{ op: "row.appended", row: row(50) }]));
  store.handleFrame(deltaFrame(7, 8, [{ op: "row.appended", row: row(3) }], "sub-stale"));
  assert.equal(notified(), 2);
  assert.equal(store.getState().snapshot?.seq, 7);
});
