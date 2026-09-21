// 运行：先 `pnpm --filter @zcode/adapters build`，再
// `node --import tsx --test test/model-io-tools-dedupe.test.ts`。
import assert from "node:assert/strict";
import test from "node:test";
import { compactModelIOTools } from "../dist/model/runner-debug.js";

const tools = [{ type: "function", function: { name: "Read", parameters: { type: "object" } } }];
const record = (body: Record<string, unknown>) => ({ request: { body }, response: {} });

test("first record keeps tools and stamps toolsHash", () => {
  const out = compactModelIOTools(record({ model: "m", tools }), undefined) as {
    request: { body: { tools?: unknown; toolsHash?: string; toolsRef?: string } };
  };
  assert.deepEqual(out.request.body.tools, tools);
  assert.equal(typeof out.request.body.toolsHash, "string");
  assert.equal(out.request.body.toolsRef, undefined);
});

test("unchanged tools collapse to a toolsRef on later records", () => {
  const first = compactModelIOTools(record({ model: "m", tools }), undefined) as {
    request: { body: { toolsHash: string } };
  };
  const state = { toolsHash: first.request.body.toolsHash };
  const out = compactModelIOTools(record({ model: "m", tools }), state) as {
    request: { body: { tools?: unknown; toolsRef?: string; model: string } };
  };
  assert.equal(out.request.body.tools, undefined);
  assert.equal(out.request.body.toolsRef, state.toolsHash);
  assert.equal(out.request.body.model, "m");
});

test("changed tools are written in full again", () => {
  const state = { toolsHash: "stale" };
  const out = compactModelIOTools(record({ tools }), state) as {
    request: { body: { tools?: unknown; toolsRef?: string } };
  };
  assert.deepEqual(out.request.body.tools, tools);
  assert.equal(out.request.body.toolsRef, undefined);
});

test("records without body.tools are untouched", () => {
  const input = record({ model: "m" });
  assert.deepEqual(compactModelIOTools(input, { toolsHash: "x" }), input);
});
