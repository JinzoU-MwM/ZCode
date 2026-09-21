// 运行：先 `pnpm --filter @zcode/core build`，再
// `node --import tsx --test test/context-system-blocks.test.ts`。
import assert from "node:assert/strict";
import test from "node:test";
import { createContextBuilder } from "../dist/context/builder.js";

function build() {
  const envInfo = {
    workingDirectory: "/home/x/proj",
    platform: "linux",
    shell: "bash",
    osVersion: "Linux",
    isGitRepository: true,
    git: { currentBranch: "main", mainBranch: "main", status: "(clean)", recentCommits: [] },
  };
  return createContextBuilder({
    workingDirectory: "/home/x/proj",
    envInfo,
    presentationSurface: "zcode_desktop",
    currentDate: "2026-09-21",
    memoryRoot: "/home/x/.zcode/memory",
    outputStyle: { name: "Caveman", prompt: "be terse" },
    guidanceToolNames: ["Read", "Bash", "Skill"],
  } as never).build();
}

test("install-stable dynamic sections precede workspace/session sections", () => {
  const order = build().sections.map((section) => section.source);
  const index = (source: string) => order.indexOf(source as never);
  assert.ok(index("dynamic_behavior") < index("memory"));
  assert.ok(index("context_management") < index("memory"));
  assert.ok(index("context_management") < index("env_info"));
  assert.ok(index("memory") < index("env_info"));
  assert.ok(index("output_style") < index("system_context"));
});

test("system prompt is four blocks with at most three cache breakpoints", () => {
  const { systemMessages, sections } = build();
  const text = systemMessages.map((m) => String(m.content));
  assert.equal(systemMessages.length, 4);
  assert.equal(systemMessages[0].cacheControl, undefined);
  assert.equal(systemMessages.filter((m) => m.cacheControl).length, 3);
  const content = (source: string) =>
    sections.find((s) => s.source === (source as never))!.content;
  assert.ok(text[2].includes(content("context_management")));
  assert.ok(!text[2].includes(content("env_info")));
  assert.ok(text[3].includes(content("env_info")));
  // 两个 dynamic block 拼接后与单块按序拼接一致：OpenAI-compatible 合并不引入额外空白。
  const dynamic = sections.filter(
    (s) => s.injectionTarget === "system" && s.cacheHint === "dynamic",
  );
  assert.equal(text[2] + text[3], `\n\n${dynamic.map((s) => s.content).join("\n\n")}`);
});
