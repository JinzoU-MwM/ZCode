import assert from "node:assert/strict";
import test from "node:test";
import {
  diffRequestFingerprints,
  fingerprintProviderRequest,
} from "./request-prefix-fingerprint.ts";

const tools = [
  { name: "Read", inputSchema: { type: "object" } },
  { name: "Bash", inputSchema: { type: "object" } },
] as never;

function messages(...texts: string[]) {
  return texts.map((text, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: text,
  }));
}

test("first request has no previous", () => {
  const next = fingerprintProviderRequest({ messages: messages("a"), tools });
  assert.equal(diffRequestFingerprints(undefined, next).kind, "first");
});

test("append-only history reports append", () => {
  const previous = fingerprintProviderRequest({ messages: messages("a", "b"), tools });
  const next = fingerprintProviderRequest({ messages: messages("a", "b", "c"), tools });
  const report = diffRequestFingerprints(previous, next);
  assert.equal(report.kind, "append");
  assert.equal(report.sharedPrefixLength, 2);
  assert.equal(report.toolsChanged, false);
});

test("moving cacheControl does not count as divergence", () => {
  const previous = fingerprintProviderRequest({
    messages: [
      { role: "user", content: "a", cacheControl: { type: "ephemeral" } },
      { role: "assistant", content: "b" },
    ],
    tools,
  });
  const next = fingerprintProviderRequest({
    messages: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b", cacheControl: { type: "ephemeral" } },
      { role: "user", content: "c" },
    ],
    tools,
  });
  assert.equal(diffRequestFingerprints(previous, next).kind, "append");
});

test("changed middle message reports index and source", () => {
  const previous = fingerprintProviderRequest({ messages: messages("a", "b", "c"), tools });
  const next = fingerprintProviderRequest({
    messages: messages("a", "B", "c"),
    tools,
    sourceEntries: [
      undefined,
      { kind: "attachment", content: "B", metadata: { source: "todo_reminder" } },
      undefined,
    ],
  });
  const report = diffRequestFingerprints(previous, next);
  assert.equal(report.kind, "diverged");
  assert.equal(report.divergedIndex, 1);
  assert.equal(report.divergedSource, "todo_reminder");
  assert.equal(report.previousSource, "assistant");
  assert.equal(report.divergedAtPreviousTail, false);
});

test("rewritten previous tail is flagged", () => {
  const previous = fingerprintProviderRequest({ messages: messages("a", "b"), tools });
  const next = fingerprintProviderRequest({ messages: messages("a", "b+more", "c"), tools });
  const report = diffRequestFingerprints(previous, next);
  assert.equal(report.kind, "diverged");
  assert.equal(report.divergedAtPreviousTail, true);
});

test("shorter history reports shrunk", () => {
  const previous = fingerprintProviderRequest({ messages: messages("a", "b", "c"), tools });
  const next = fingerprintProviderRequest({ messages: messages("a", "b"), tools });
  assert.equal(diffRequestFingerprints(previous, next).kind, "shrunk");
});

test("tool list order change reports toolsChanged", () => {
  const previous = fingerprintProviderRequest({ messages: messages("a"), tools });
  const next = fingerprintProviderRequest({
    messages: messages("a", "b"),
    tools: [tools[1], tools[0]] as never,
  });
  const report = diffRequestFingerprints(previous, next);
  assert.equal(report.kind, "append");
  assert.equal(report.toolsChanged, true);
});
