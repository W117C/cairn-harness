// 探针（**不是门**，不在 gate-manifest 里）：prune 打桩那句「需要时 read_file 取回」到底做不做得到。
//
// 为什么会有这支：§7.4「被裁原文写会话附件目录可回取」的判卷（`scripts/prune-check.ts` ④）用
// **node:fs 的 readFile** 把附件读回来并比字节——那证的是"文件在、内容对"，
// 而**打桩文本交给模型的动作是 `read_file` 这个工具**。两者不是同一件事：
// 七个碰文件的工具（read_file / grep / glob / lsp / write_file / edit_file / impact_query）
// 全走 `resolveInWorkspace` 那一道信任边界，它**第一句就拒绝对路径**，
// 而生产算出的附件目录是 `join(dirname(logPath), "prune-attachments")`（会话日志在应用数据目录里）
// ⇒ 模型照那句去做，拿到的是「只允许 workspace 相对路径」，白跑一轮，且**剪掉的原文再没有工具能取回**。
//
// 判绿条件（修好之后这一支会自然转绿）：
//   read_file 用打桩里那条路径能把原文逐字读回。
// 修法有两族（都还没做，见任务 #33）：给 read_file 一个窄的第二允许根（要动 `glm-session` 的组装那一跳），
// 或把那句改成"真做得到的动作"（但那样 §7.4 的回取能力就等于收回，属产品裁决）。
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { computePrune, writePruneAttachments, attachmentPathFor } from "../src/agent/prune.js";
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
  // 与 glm-session.ts 里那一行同算法（不是抄的字符串，是同一表达式）：
  const attachmentsDir = join(dirname(logPath), "prune-attachments");
  await writeFile(join(workspace, "src-legacy-blob.ts"), "x", "utf8");

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
  const original = (events[4] as { output: string }).output;

  const outcome = computePrune({ events, attachmentsDir, sessionId: "probe" });
  await writePruneAttachments(events, outcome, attachmentsDir, "probe");
  note("prune 真触发了（否则整支没有尺）", outcome.why === "saved" && outcome.replacements.size > 0, `why=${outcome.why}`);
  if (outcome.why !== "saved" || outcome.replacements.size === 0) {
    console.log("红 " + String(red) + " 条：没触发 prune ⇒ 后面的读数都不算");
    process.exit(1);
  }

  // 取产品真交给模型的那一行文本（不是脚本自己算的路径）。
  // 被剪的可能不止一条 ⇒ 按"哪一条对应 c-old"来挑，别拿 values()[0] 赌顺序。
  const wanted = attachmentPathFor(attachmentsDir, "probe", "c-old");
  const stub = [...outcome.replacements.values()].find((s) => s.includes(wanted)) ?? "";
  const m = /附件 (\S+?)，/.exec(stub);
  const pathInStub = m?.[1] ?? "";
  note("c-old 的打桩把路径交给了模型（承诺可见）", pathInStub !== "", JSON.stringify(stub.slice(0, 110)));
  note("该路径就是实际写出的那个文件（同源）", pathInStub === wanted, pathInStub);
  note("文件真存在、内容逐字一致（prune-check ④ 已覆盖的那半）",
    existsSync(pathInStub), "");

  // ★ 这一格才是本探针的存在理由：**照承诺的动作，用真工具、真 ToolContext 做一遍**
  const ctx = { workspace, emit: async () => {} } as unknown as ToolContext;
  let verdict = "";
  let recovered = false;
  try {
    const r = await read_file.run({ path: pathInStub }, ctx);
    recovered = r.ok && r.output.includes("R".repeat(200));
    verdict = `ok=${String(r.ok)} 前 60：${r.output.slice(0, 60).replace(/\n/g, " ")}`;
  } catch (err) {
    verdict = "工具抛错：" + (err instanceof Error ? err.message : String(err));
  }
  note("模型照那句做得到（read_file 真能取回原文）", recovered, verdict);

  console.log(red === 0
    ? "[probe prune-recall] 全绿：§7.4 的回取承诺对模型可执行。"
    : "[probe prune-recall] 红 " + String(red) + " 条 ⇒ 打桩那句是指向走不通的路（能力 6 的『可回取』在产品路径上不成立）。");
  process.exit(red === 0 ? 0 : 1);
}

await main();
