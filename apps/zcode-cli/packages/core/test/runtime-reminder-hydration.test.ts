// 运行：先 `pnpm --filter @zcode/core build`，再
// `node --import tsx --test test/runtime-reminder-hydration.test.ts`（@zcode/shared 以 src 形式解析）。
import assert from "node:assert/strict";
import test from "node:test";
import { createMessageHistory } from "../dist/agent/message-history.js";
import { hydrateMessageHistoryFromSession } from "../dist/agent/session-history-hydrator.js";

const sessionID = "ses_test";

function userMessage(id: string, text: string) {
  return {
    info: { id, sessionID, role: "user", time: { created: 1 }, agent: "zcode-agent" },
    parts: [{ id: `${id}_p`, sessionID, messageID: id, type: "text", text }],
  };
}

function runtimeReminderMessage(id: string, source: string, text: string) {
  const metadata = { source: "runtime_reminder", visibility: "model-only", runtimeMessage: { source } };
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 2 },
      agent: "zcode-agent",
      source: "runtime_reminder",
      synthetic: true,
      visibility: "model-only",
      metadata,
    },
    parts: [{ id: `${id}_p`, sessionID, messageID: id, type: "text", text, synthetic: true, metadata }],
  };
}

test("runtime_reminder notice hydrates back to the original attachment source in order", async () => {
  const history = createMessageHistory();
  history.init([]);
  const body = "Caveman output style is active. Remember to follow the specific guidelines for this style.";
  await hydrateMessageHistoryFromSession({
    history,
    messages: [
      userMessage("msg_1", "hello") as never,
      runtimeReminderMessage("msg_2", "output_style", body) as never,
      runtimeReminderMessage("msg_3", "hook_context", "hook says hi") as never,
    ],
  });
  const entries = history.borrowReadOnlyRuntimeEntries();
  assert.equal(entries.length, 3);
  assert.equal(entries[0].kind ?? "message", "message");
  assert.equal(entries[1].kind, "attachment");
  assert.equal(entries[1].metadata.source, "output_style");
  assert.equal(entries[1].content, body);
  assert.equal(entries[2].kind, "attachment");
  assert.equal(entries[2].metadata.source, "hook_context");
});
