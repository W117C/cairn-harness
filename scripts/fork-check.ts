// fork-check —— 会话分支验收：真实建一段会话日志，从事件点分支，断言：
//   ①新会话事件数 = N+1（前缀 + session_meta）  ②新会话前 N 条与原会话逐字一致
//   ③原会话文件 sha256 与分支前逐字一致。
// 任一断言失败 → 退出码非 0。
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog, forkSession, replay } from "../src/events";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

const dir = await mkdtemp(join(tmpdir(), "m1a-fork-check-"));
try {
  // 准备：一段含流式增量的真实会话日志（append-only 写出）
  const sessionPath = join(dir, "events.jsonl");
  const log = createEventLog(sessionPath);
  const written = [
    { type: "user_message", content: "修 bug" },
    { type: "assistant_delta", callId: "a1", text: "我先" },
    { type: "assistant_delta", callId: "a1", text: "看看" },
    { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.ts" } },
    { type: "tool_result", callId: "c1", ok: true, output: "..." },
  ] as const;
  for (const e of written) await log.append(e);
  const shaBefore = createHash("sha256").update(await readFile(sessionPath)).digest("hex");
  console.log("[fork-check] 原会话 5 条事件 @ " + sessionPath);

  // 分支：从事件点 3（第 2 条 delta）派生
  const forkDir = join(dir, "fork");
  const res = await forkSession(sessionPath, "3", forkDir);
  console.log("[fork-check] 分支事件点 eventId=3 → 新会话 " + res.eventsPath);

  const original = await replay(sessionPath);
  const forked = await replay(res.eventsPath);
  assert(res.count === 4 && forked.length === 4, "新会话事件数 = N+1（3+1=" + String(res.count) + "）");
  assert(
    JSON.stringify(forked.slice(0, 3)) === JSON.stringify(original.slice(0, 3)),
    "新会话前 N 条与原会话逐字一致",
  );
  const meta = forked[forked.length - 1];
  assert(
    meta.type === "session_meta" && meta.branch_of === sessionPath,
    "末条为 session_meta{branch_of: 原会话路径}",
  );
  const shaAfter = createHash("sha256").update(await readFile(sessionPath)).digest("hex");
  assert(shaAfter === shaBefore, "原会话文件 sha256 与分支前逐字一致");

  // 边界：在末事件点分支 → N = 全部长度；越界 id 拒绝
  const atEnd = await forkSession(sessionPath, "5", join(dir, "fork-end"));
  assert(atEnd.count === 6, "末事件点分支 → 事件数 = 5+1");
  let rejected = false;
  try {
    await forkSession(sessionPath, "6", join(dir, "fork-bad"));
  } catch {
    rejected = true;
  }
  assert(rejected, "越界 eventId 被拒绝（fail loud）");
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error("[fork-check] 失败: " + String(failures) + " 项断言未通过");
  process.exitCode = 1;
} else {
  console.log("[fork-check] 全部断言通过");
}
