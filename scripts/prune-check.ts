// M2b prune 明卷（任务 6 验收）：
// ①未达 20k 不修剪 ②最近 2 轮结果不被剪 ③免剪名单条目（skill/grep/错误结果/卡片投影/user_message）不被剪
// ④被裁原文能从附件目录读回且与原文逐字一致。
// 真实事件流 = 程序化构造的长会话（tool_result 大块 read/shell 输出），全链零 LLM。
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computePrune,
  writePruneAttachments,
  attachmentPathFor,
  PRUNED_PLACEHOLDER,
  DEFAULT_PRUNE_CONFIG,
} from "../src/agent/prune.js";
import { projectContext } from "../src/agent/context.js";
import { read_file } from "../src/tools/read_file.js";
import type { ToolContext } from "../src/tools/base.js";
import type { AgentEvent } from "../src/events";

let failed = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push(`  ${ok ? "✅" : "❌"} ${name}${detail ? "（" + detail + "）" : ""}`);
  if (!ok) failed++;
}

const KB = 1024;

async function main(): Promise<void> {
  // 附件目录**放在工作区内**，这样打桩交出的就是模型真能用的相对路径（#33：生产的附件在会话目录里，
  // 与工作区不同根 ⇒ 那种形状由 `probe-prune-recall` 判"必须改口"，两支各判一侧，不重复造尺）。
  const ws = await mkdtemp(join(tmpdir(), "m2b-prunecheck-"));
  const attachments = await mkdir(join(ws, "prune-attachments"), { recursive: true }).then(() => join(ws, "prune-attachments"));
  // 程序化长会话：第 1 轮（旧，免剪区外）skill 注入 25k + 普通大 read 25k；第 2 轮 grep 15k + 错误 read 15k；
  // 第 3 轮最新 run_shell 15k + read 15k。总 token > 保护区 40k → 第 1 轮进入候选。
  const events: AgentEvent[] = [
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
  ];

  const outcome = computePrune({ events, attachmentsDir: attachments, sessionId: "prunecheck", workspace: ws });
  check("prune 触发（saved，非 none/too-small）", outcome.why === "saved", `why=${outcome.why} savedTokens=${outcome.savedTokens}`);
  check("①被剪量 ≥ 最小修剪 20k", outcome.savedTokens >= DEFAULT_PRUNE_CONFIG.minimumTokens, `saved=${outcome.savedTokens}`);
  check("②最近 2 轮结果不被剪（第 2、3 轮全部保留）",
    !outcome.replacements.has(8) && !outcome.replacements.has(10) &&
    !outcome.replacements.has(13) && !outcome.replacements.has(15),
    `pruned=[${[...outcome.replacements.keys()].join(",")}]`);
  check("③免剪名单：skill 内容不被剪", !outcome.replacements.has(3), `pruned=[${[...outcome.replacements.keys()].join(",")}]`);
  check("③b 免剪名单：grep / 错误结果 / 卡片投影不被剪", !outcome.replacements.has(8) && !outcome.replacements.has(10), "");
  check("③c 普通旧大 read 被剪（唯一被剪）", outcome.replacements.size === 1 && outcome.replacements.has(5), "");
  // 判据修订（2026-09-20 接进「存盘回取」；2026-09-26 #33 再改强）：原先这里只要求打桩**含附件目录**，
  // 而那交出的是绝对路径——`read_file` 第一句就拒绝对路径 ⇒ 承诺对模型不可执行。现在要求：
  // 原串逐字在场 + 交的是**工作区相对路径** + 绝不出现绝对路径。
  const stub5 = outcome.replacements.get(5) ?? "";
  const relAttachment = attachmentPathFor(attachments, "prunecheck", "c-old").slice(ws.length + 1);
  check("③d 打桩保留占位原串，并交出工作区相对路径（不给绝对路径）",
    stub5.startsWith(PRUNED_PLACEHOLDER) && stub5.includes(relAttachment) && !/／[a-z]/i.test(stub5.slice(PRUNED_PLACEHOLDER.length)) && !stub5.includes(attachments),
    stub5.slice(0, 120));
  check("③e user_message 永不被剪", ![...outcome.replacements.keys()].some((id) => events[id - 1].type === "user_message"), "");

  // ④ 附件回取：逐字一致
  await writePruneAttachments(events, outcome, attachments, "prunecheck");
  const original = (events[4] as { output: string }).output;
  const got = await readFile(attachmentPathFor(attachments, "prunecheck", "c-old"), "utf8");
  check("④被裁原文从附件目录读回且逐字一致", got === original, `len=${got.length}/${original.length}`);
  // 打桩交出的路径必须就是刚写出的那个文件（承诺与实物同源，不是两处各算各的）
  check("④b 打桩那行路径 = 实际写出的附件路径（相对形式）",
    stub5.includes(relAttachment) && relAttachment === "prune-attachments/" + (relAttachment.split("/")[1] ?? ""),
    relAttachment);
  // ★ 承诺的动作要用**模型的那个工具**验，不是 node:fs（fs 读得到不代表模型够得着——#33 就是这么漏的）。
  const recall = await read_file.run({ path: relAttachment }, { workspace: ws } as unknown as ToolContext);
  check("④c 模型照那句做得到：read_file(相对路径) 读回原文前缀",
    recall.ok && recall.output.includes("R".repeat(100)), String(recall.output).slice(0, 60));

  // 投影：projectContext 消费 replacements → tool content 打桩、事件流本体零删改
  const msgs = projectContext(events, outcome.replacements);
  const stubbed = msgs.some((m) => m.role === "tool" && typeof m.content === "string" && m.content.startsWith(PRUNED_PLACEHOLDER));
  const intact = (events[4] as { output: string }).output === original;
  check("⑤投影打桩生效且事件流零删改", stubbed && intact, "");

  // 打桩后上下文确实变小（省 token 的存在性证明）
  const before = JSON.stringify(projectContext(events)).length;
  const after = JSON.stringify(msgs).length;
  check("⑥投影后上下文 < 打桩前", after < before, `${before} → ${after}`);

  await rm(ws, { recursive: true, force: true });
  console.log("[prune-check] 类型化裁剪验收");
  for (const r of results) console.log(r);
  console.log(failed === 0 ? "✅ prune-check 全部通过" : `❌ prune-check 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[prune-check] 异常:", err);
  process.exit(1);
});
