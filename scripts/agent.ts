// 通用入口：pnpm agent [workspace] [fixture.jsonl] [用户消息]
// 用 mock provider 跑一轮 agent loop，事件日志写到 .tmp/agent-log.jsonl（运行产物，不进 git）。
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../src/agent/loop";
import { createEventLog, replay } from "../src/events";
import { createMockProvider } from "../src/providers/mock";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(ROOT, process.argv[2] ?? "fixtures/todo-app");
const fixture = resolve(ROOT, process.argv[3] ?? "fixtures/mock/todo-fix.jsonl");
const message = process.argv[4] ?? "修复 fixtures/todo-app 中失败的测试";
const LOG = join(ROOT, ".tmp", "agent-log.jsonl");
const TARGET = join(workspace, "src", "todo.ts");
const BUG = join(ROOT, "fixtures", "mock", "todo-bug.ts");

await mkdir(join(ROOT, ".tmp"), { recursive: true });
await rm(LOG, { force: true });
// 靶子源码是生成物（不进 git）：先重置到带 bug 的起始状态，保证可重复。
await cp(BUG, TARGET).catch(() => undefined);
await runLoop({
  provider: createMockProvider(fixture),
  events: createEventLog(LOG),
  workspace,
  mode: "auto",
  userMessage: message,
});
const log = await replay(LOG);
console.log(`agent loop 完成：${log.length} 条事件 → ${LOG}`);
for (const e of log) console.log(`  ${e.type}`);
