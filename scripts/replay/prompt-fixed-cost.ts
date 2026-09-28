// 复跑面 · 登记项 `replay:prompt-fixed-cost`（每请求**固定重发面**的开销：逐档多少字符、占实测输入多少）
//
// 为什么这条面值得存在（第 89 页的遗留）：提示词 A/B 的**幅度**要等同配置重复把噪声底（实测 3.34×）压住才能引用，
// 那要花时间也花钱；但"长提示"的成本里有一块**不用跑就知道**——每请求固定重发的那一份输入本身。
// 它就是 `面 × 请求数`，而请求数与实测输入都在既有 usage 事件里 ⇒ 一个不需要新数据就能报的代价数。
// **第 185 页改的两处口径**：⑴ 分子从前只有 `BASE_SYSTEM`，而标签说的是"每请求固定输入"——
// 真上 wire 的固定面还包含逐档重发的**工具规格**（default 档：提示 670 字符 vs 规格 10,131 字符
// ＝面里 93.8% 从来没进分子）；⑵ 占比从前 `Math.min(1, …)` 夹住，把"18/19 条流估超实测输入"
// 那片物理不可能的数夹成一片 100%（规则 242：一片相同的数是常数的签名，不是测量的签名）——
// 现在原样报，并由 `minAdmissibleFactor` 反解出这一面的字符/token 下界。
// 口径一律复用现成的面，不另起一把尺：请求数/输入 token 取 `run-scorecard` 的 `usageOfStream`，
// chars/token 系数取 `calibrateFactor`（无样本回退 4，并把实际用的系数打出来）。
//
// 退出码：0＝有数可读；1＝语料为空或一条请求都没有（＝没尺，不是"开销为零"）。
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { systemPromptFor } from "../../src/main/agent-runner";
import { PERMISSION_MODES } from "../../src/permissions/modes";
import { sessionToolSpecs } from "../../src/agent/glm-session";
import { calibrateFactor } from "../../src/agent/compaction";
import type { AgentEvent } from "../../src/events";
import { fixedFacesOfModes, minAdmissibleFactor, promptCostRows, promptShareOfFixedFace, summarizePromptCost } from "../lib/prompt-cost";
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
  const state = gitState(AGENT_RUNNER);
  // 分子取的是**真的上 wire 的那一份**：逐档调生产端的 `systemPromptFor` 与 `sessionToolSpecs`
  // （与 prompt-surface 门同一个决策点，不另起一把尺）。旧口径只有 `BASE_SYSTEM.length`，
  // 而 default 档的规格面是提示的 15 倍 ⇒ 标签说「每请求固定输入」、分子只报其中 6%。
  const faces = fixedFacesOfModes(
    PERMISSION_MODES.map((m) => ({
      mode: m as string,
      promptChars: systemPromptFor(m).length,
      specs: sessionToolSpecs({ mode: m }).specs,
    })),
  );
  const billed = faces.find((f) => f.mode === "default") ?? faces[0]!;
  const perFile: { file: string; requests: number; measuredInputTokens: number }[] = [];
  let allEvents: AgentEvent[] = [];
  for (const f of scan.files) {
    const events = readJsonl(f) as readonly AgentEvent[];
    allEvents = allEvents.concat(events as AgentEvent[]);
    const t = usageOfStream(events);
    perFile.push({ file: f, requests: t.usageEvents, measuredInputTokens: t.inputTokens });
  }
  const factor = calibrateFactor(allEvents);
  const rows = promptCostRows(perFile, { promptChars: billed.totalChars, factor });
  const s = summarizePromptCost(rows);
  // 系数自检：占比 >1 在物理上不可能（固定面只是输入的一部分），所以「有多少条流估超了」反解出来
  // 就是这一面的字符/token **下界**——这比再猜一个系数诚实，也让这把尺能证伪自己。
  const admissible = minAdmissibleFactor(billed.totalChars, perFile);
  const lowPerReq = admissible === null ? Math.ceil(billed.totalChars / factor) : Math.ceil(billed.totalChars / admissible);
  const highPerReq = Math.ceil(billed.totalChars / factor);
  console.log(
    "每请求固定面（逐档；分子＝系统提示 + 序列化工具规格）· git 状态=" + state +
      " · chars/token 系数 " + factor.toFixed(2) + "（calibrateFactor；无样本回退 4）",
  );
  for (const f of faces) {
    const share = promptShareOfFixedFace(f);
    console.log(
      "  " + f.mode.padEnd(10) +
        " 提示 " + String(f.promptChars).padStart(6) +
        " ＋ 规格 " + String(f.toolSpecChars).padStart(7) + "（" + String(f.tools) + " 把）" +
        " ⇒ 面 " + String(f.totalChars).padStart(7) + " 字符" +
        "（系统提示占面 " + (share === null ? "未记" : (share * 100).toFixed(1) + "%") + "）",
    );
  }
  console.log(
    "  ⇒ 逐流摊按 **" + billed.mode + "** 档的面：" + String(billed.totalChars) + " 字符/请求 ⇒ token 估 " +
      String(lowPerReq) + "–" + String(highPerReq) + "（下界＝系数自检，上界＝池化系数）；" +
      "旧口径只数系统提示 ⇒ 从前这条把固定面少看 " +
      (((billed.totalChars - billed.promptChars) / billed.totalChars) * 100).toFixed(1) + "%",
  );
  console.log(
    "     系数自检：按池化系数 " + factor.toFixed(2) + " 摊，" + String(s.streams) + " 条可摊流里有 **" + String(s.overshoot) +
      " 条估出「固定 > 该流实测输入」**（不可能）⇒ 面的真实字符/token 至少 " +
      (admissible === null ? "无从反解（没有可用流）" : admissible.toFixed(2)) +
      "；池化系数来自中文散文，而面里九成以上是英文 JSON 规格 ⇒ 用它是把成本放大",
  );
  console.log(
    "     （usage 事件不带权限档 ⇒ 每条流当时是哪一档分不出来，所以统一按 default 档摊；" +
      "read-only 只发 8 把工具，若那批流真跑的是只读档，这里就**高估**了）",
  );
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
      " · 估出「固定 > 实测输入」的流 " + String(s.overshoot) + " 条（>100% 不夹住，见上面的系数自检）" +
      " · 合计固定 " + String(s.fixedTotal) + " / 合计实测输入 " + String(s.inputTotal) + " token",
  );
  if (state !== "与 HEAD 一致") {
    console.log("⚠️ 长度取自**工作树**（agent-runner 在飞：" + state + "）⇒ 这句读的是「那笔入库后的开销」，不是 HEAD 的开销");
  }
  process.exitCode = 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
