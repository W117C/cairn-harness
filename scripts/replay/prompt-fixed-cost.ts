// 复跑面 · 登记项 `replay:prompt-fixed-cost`（生产系统提示的**固定开销**：每请求付多少、占实测输入多少）
//
// 为什么这条面值得存在（第 89 页的遗留）：提示词 A/B 的**幅度**要等同配置重复把噪声底（实测 3.34×）压住才能引用，
// 那要花时间也花钱；但"长提示"的成本里有一块**不用跑就知道**——每请求固定重发的系统提示本身。
// 它就是 `提示长度 × 请求数`，而请求数与实测输入都在既有 usage 事件里 ⇒ 一个不需要新数据就能报的代价数。
// 口径一律复用现成的面，不另起一把尺：请求数/输入 token 取 `run-scorecard` 的 `usageOfStream`，
// chars/token 系数取 `calibrateFactor`（无样本回退 4，并把实际用的系数打出来）。
//
// 退出码：0＝有数可读；1＝语料为空或一条请求都没有（＝没尺，不是"开销为零"）。
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_SYSTEM } from "../../src/main/agent-runner";
import { calibrateFactor } from "../../src/agent/compaction";
import type { AgentEvent } from "../../src/events";
import { promptCostRows, summarizePromptCost } from "../lib/prompt-cost";
import { usageOfStream } from "./run-scorecard";
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";

const AGENT_RUNNER = "src/main/agent-runner.ts";

/** `BASE_SYSTEM` 住在别人的在飞文件里 ⇒ 长度的**取料树**必须自己说出来（同第 84 页那句：绿在哪棵树）。 */
function gitState(path: string): string {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", path], { encoding: "utf8" }).trim();
    return out === "" ? "与 HEAD 一致" : out.slice(0, 2).trim() || "?";
  } catch {
    return "git 不可用";
  }
}

function main(): void {
  const scan = scanCorpus();
  const empty = zeroCorpusProblem(scan);
  if (empty !== null) {
    console.error("⚠️ prompt-fixed-cost 读数无意义：" + empty);
    process.exitCode = 1;
    return;
  }
  const prompt = BASE_SYSTEM;
  const state = gitState(AGENT_RUNNER);
  const perFile: { file: string; requests: number; measuredInputTokens: number }[] = [];
  let allEvents: AgentEvent[] = [];
  for (const f of scan.files) {
    const events = readJsonl(f) as readonly AgentEvent[];
    allEvents = allEvents.concat(events as AgentEvent[]);
    const t = usageOfStream(events);
    perFile.push({ file: f, requests: t.usageEvents, measuredInputTokens: t.inputTokens });
  }
  const factor = calibrateFactor(allEvents);
  const rows = promptCostRows(perFile, { promptChars: prompt.length, factor });
  const s = summarizePromptCost(rows);
  console.log(
    "提示长度 " + String(prompt.length) + " 字符（`BASE_SYSTEM`，git 状态=" + state + "）" +
      " · chars/token 系数 " + factor.toFixed(2) + "（calibrateFactor；无样本回退 4）",
  );
  console.log("  ⇒ 每请求固定输入 ≈ " + String(Math.ceil(prompt.length / factor)) + " token");
  if (rows.length === 0) {
    console.error("❌ 语料里一条带 usage 的流都没有 ⇒ 无从摊（这句不是「开销为 0」，是没有尺）");
    process.exitCode = 1;
    return;
  }
  console.log("  —— 逐流（前 12 条）");
  for (const r of rows.slice(0, 12)) {
    console.log(
      "    " + r.file.split("/").slice(-2).join("/").padEnd(46) +
        " 请求=" + String(r.requests).padStart(3) +
        " 固定≈" + String(r.fixedTokens).padStart(7) +
        " 实测输入=" + String(r.measuredInputTokens).padStart(8) +
        " 占比=" + (r.share === null ? "未记" : (r.share * 100).toFixed(0) + "%") +
        (r.note === "" ? "" : "（" + r.note + "）"),
    );
  }
  console.log(
    "\n汇总：可摊流 " + String(s.streams) + " 条 · 中位占比 " + (s.medianShare === null ? "未记" : (s.medianShare * 100).toFixed(0) + "%") +
      " · 最大 " + (s.maxShare === null ? "未记" : (s.maxShare * 100).toFixed(0) + "%") +
      " · 合计固定 " + String(s.fixedTotal) + " / 合计实测输入 " + String(s.inputTotal) + " token",
  );
  if (state !== "与 HEAD 一致") {
    console.log("⚠️ 长度取自**工作树**（agent-runner 在飞：" + state + "）⇒ 这句读的是「那笔入库后的开销」，不是 HEAD 的开销");
  }
  process.exitCode = 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
