// 探针（**不是门**，不在 gate-manifest 里）：生产的 prune 打桩在附件**工作区之外**时，有没有改口成诚实话。
//
// 为什么会有这支：§7.4「被裁原文写会话附件目录可回取」原先无论附件落在哪儿都写
// 「[原文已存附件 <绝对路径>，需要时 read_file 取回]」。而生产算出的附件目录是
// `join(dirname(logPath), "prune-attachments")`（会话日志在应用数据目录里），与工作区不同根；
// 七个碰文件的工具全走 `resolveInWorkspace` 那道信任边界，它**第一句就拒绝对路径**
// ⇒ 模型照那句去做，拿到「只允许 workspace 相对路径」，白跑一轮，且剪掉的原文再没有工具能取回。
//
// 判什么（#33 修法＝分案改文案，不开新的允许根）：
//   ① 区外那一案**不再交绝对路径**，并明说"模型侧读不到、请由用户打开"；
//   ② 附件仍然真落盘（人还得打开得到，能力没被悄悄删掉）；
//   ③ 反向哨兵：把旧写法那个绝对路径真拿去调 read_file ⇒ **必须被拒**——
//      这一格证明"如果哪天有人把绝对路径塞回去，就是假承诺"，尺的靶子没烂。
// 工作区**之内**那一案（交相对路径、模型真取得回）由 `scripts/prune-check.ts` ③d/④b/④c 判，
// 两支各判一侧，不重复造尺（规则 100：同一条判据抄两份迟早漂）。
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { computePrune, writePruneAttachments, attachmentPathFor, PRUNED_PLACEHOLDER } from "../src/agent/prune.js";
import { read_file } from "../src/tools/read_file.js";
import type { AgentEvent } from "../src/events/index.js";
import type { ToolContext } from "../src/tools/base.js";

const KB = 1024;
let red = 0;
const note = (label: string, ok: boolean, detail: string): void => {
  if (!ok) red++;
  console.log(`  ${(ok ? "✅" : "❌")} ${label}${detail ? " — " + detail : ""}`);
};

async function main(): Promise<void> {
  console.log("[probe prune-recall] 未修缺陷探针：**不进 gate-manifest**，exit 1 = 缺陷还在（不是门红）");

  // 工作区与会话日志目录**分家**——这是生产的真实形状（logPath 在应用数据目录里）。
  const workspace = await mkdtemp(join(tmpdir(), "probe-recall-ws-"));
  const logDir = await mkdtemp(join(tmpdir(), "probe-recall-logs-"));
  const logPath = join(logDir, "session.events.jsonl");
  await writeFile(logPath, "", "utf8");
  // 与 session-provider.ts 里那一行同算法（不是抄的字符串，是同一表达式）：
  const attachmentsDir = join(dirname(logPath), "prune-attachments");

  // 触发形状**逐字照抄** `scripts/prune-check.ts` 的长会话（那边稳定出 `why==="saved"`；
  // 自己减事件会掉回 none，那样本探针就成了"没有尺"而不是"红"——见下一格的守卫）。
  const events = [
    { type: "user_message", content: "第 1 轮：技能注入与读大文件" },
    { type: "tool_call", id: "c-skill", name: "skill", args: { name: "x" } },
    { type: "tool_result", callId: "c-skill", ok: true, output: "S".repeat(100 * KB) },
    { type: "tool_call", id: "c-old", name: "read_file", args: { path: "src/legacy/blob.ts" } },
    { type: "tool_result", callId: "c-old", ok: true, output: "R".repeat(100 * KB) },
    { type: "user_message", content: "第 2 轮：搜索" },
    { type: "tool_call", id: "c-grep", name: "grep", args: { pattern: "needle" } },
    { type: "tool_result", callId: "c-grep", ok: true, output: "G".repeat(60 * KB) },
    { type: "tool_call", id: "c-err", name: "read_file", args: { path: "missing.ts" } },
    { type: "tool_result", callId: "c-err", ok: false, output: "E".repeat(60 * KB) },
    { type: "user_message", content: "第 3 轮（最近）：跑测试" },
    { type: "tool_call", id: "c-shell", name: "run_shell", args: { command: "pnpm test" } },
    { type: "tool_result", callId: "c-shell", ok: true, output: "T".repeat(60 * KB) },
    { type: "tool_call", id: "c-new", name: "read_file", args: { path: "src/new.ts" } },
    { type: "tool_result", callId: "c-new", ok: true, output: "N".repeat(60 * KB) },
  ] as unknown as AgentEvent[];

  const outcome = computePrune({ events, attachmentsDir, sessionId: "probe" });
  await writePruneAttachments(events, outcome, attachmentsDir, "probe");
  note("prune 真触发了（否则整支没有尺）", outcome.why === "saved" && outcome.replacements.size > 0, `why=${outcome.why}`);
  if (outcome.why !== "saved" || outcome.replacements.size === 0) {
    console.log("红 " + String(red) + " 条：没触发 prune ⇒ 后面的读数都不算");
    process.exit(1);
  }

  // ① 生产形状：附件在区外 ⇒ 打桩不许交出模型用不了的路径，且必须明说读不到。
  const wanted = attachmentPathFor(attachmentsDir, "probe", "c-old");
  const stub = [...outcome.replacements.values()].find((sv) => sv.includes(wanted) || sv.includes("模型侧读不到")) ?? "";
  note("c-old 那条打桩被改写过（含占位原串）", stub.startsWith(PRUNED_PLACEHOLDER), stub.slice(0, 60));
  note("① 区外那案不再交绝对路径", !stub.includes(attachmentsDir) && !stub.includes(wanted), stub.slice(60, 150));
  note("① 并且明说模型侧读不到（不假装可回取）",
    stub.includes("模型侧读不到") && stub.includes("由用户打开"), "");
  // ② 能力没被悄悄删：原文仍然落盘。
  note("② 附件仍然真写出（人还打开得到）", existsSync(wanted), wanted.slice(-40));
  // ③ 反向哨兵：旧写法交出的那个绝对路径，工具今天仍然拒收 ⇒ 塞回去就是假承诺。
  const ctx = { workspace, emit: async () => {} } as unknown as ToolContext;
  let rejected = false;
  let why = "";
  try {
    const r = await read_file.run({ path: wanted }, ctx);
    why = "居然读到了：ok=" + String(r.ok);
  } catch (err) {
    rejected = true;
    why = (err instanceof Error ? err.message : String(err)).slice(0, 60);
  }
  note("③ 反向哨兵：拿绝对路径去调 read_file 必须被拒", rejected, why);

  console.log(red === 0
    ? "[probe prune-recall] 全绿：区外那案已改口成诚实话，附件仍在盘上，绝对路径仍然被拒。"
    : "[probe prune-recall] 红 " + String(red) + " 条 ⇒ 打桩那句又变成指向走不通的路。");
  process.exit(red === 0 ? 0 : 1);
}

await main();
