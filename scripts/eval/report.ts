// 度量台的对账面：把两次（或多次）`pnpm bench` 的读数放在一起，回答一个问题——
// **「这次改动到底有没有变好，还是只是噪声？」**
//
// 为什么必须有这只模块：`pnpm bench` 已经能产出成功率/token/耗时/内存四读数，
// 但**单次读数什么都证明不了**。本仓自己在 2026-09-30 踩过一次：同一配置跑 4 次，
// 开关两个方向各有一次成败 ⇒ 拿单次成功率当结论是错的。要判"改动有效"，
// 至少需要三样东西：两次**同配置**运行给出的**噪声带**、一次改动后的读数、以及
// **同一批任务**这个前提（任务集换了，分母就换了，横比无意义）。
//
// 本模块只做这三件事，不碰跑法（跑法在 `scripts/loop-eval.ts`，是既有的尺，改了就没法横比）：
//   ① 读 `readings.json`（形状 = `{r, g}[]`，由 loop-eval 写出），口径不对就**出声**而不是静默跳过；
//   ② 算**噪声带**：同配置两次运行的逐指标绝对差；
//   ③ 判：改动后的读数相对基线，**逐指标**落在噪声带内还是带外，方向是改善还是退化。
//
// 诚实标注（这条比结论本身重要）：**两点噪声带是弱证据**。
// 它只能挡住"改动幅度比机器抖动还小"这种假改善，挡不住系统性偏差；
// 真要下结论请把 `--reps` 提上去、把同一配置多跑几份读数喂给 `--baseline`。
import { readFileSync } from "node:fs";

/** 跑器写出的单条读数。只取对账需要的字段——跑器加字段不会打崩本模块。 */
export interface Row {
  id: string;
  tokensIn: number;
  tokensOut: number;
  seconds: number;
  rssPeakMb: number;
  toolFailures: number;
  repeats: number;
  /** 该条任务这一轮是否达标（跑器的判卷结果）。 */
  ok: boolean;
}

/** 一份读数文件的汇总。 */
export interface Totals {
  tasks: number;
  passed: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  seconds: number;
  rssPeakMb: number;
  toolFailures: number;
  repeats: number;
}

/** 逐指标的方向：数字越小越好 / 越大越好。 */
const LOWER_IS_BETTER: ReadonlySet<keyof Totals> = new Set([
  "tokensIn", "tokensOut", "seconds", "rssPeakMb", "toolFailures", "repeats",
]);
const HIGHER_IS_BETTER: ReadonlySet<keyof Totals> = new Set(["passed", "successRate"]);

/** 参与对账的指标（顺序即打印顺序）。`tasks` 不参与——它是前提不是结果，见 `compare` 的护栏。 */
export const METRICS: readonly (keyof Totals)[] = [
  "successRate", "passed", "tokensIn", "tokensOut", "seconds", "rssPeakMb", "toolFailures", "repeats",
];

export type Verdict = "beyond-noise" | "within-noise";
export type Assessment = "better" | "worse" | "noise" | "unknown";

export interface MetricLine {
  metric: keyof Totals;
  baseline: number;
  candidate: number;
  delta: number;
  band: number | null;
  verdict: Verdict | "unknown";
  assessment: Assessment;
}

export interface Comparison {
  /** 任务集是否一致。不一致 ⇒ 一切逐指标结论作废（分母变了）。 */
  sameTaskSet: boolean;
  baselineTasks: string[];
  candidateTasks: string[];
  lines: MetricLine[];
}

function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`读数形状不对：${what} 不是有限数（实读 ${JSON.stringify(v)}）`);
  }
  return v;
}

/** 解析一份 `readings.json`。
 *
 *  形状**必须**是 loop-eval 写的那一种（`{r, g}[]`），不认识的形状**直接抛**：
 *  静默跳过一条读数，等于把一个没被算进去的分母当成"通过"——本仓点名的
 *  「取不到 ≠ 没问题」那一族。 */
export function parseReadings(text: string, label = "readings"): Row[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(raw)) throw new Error(`${label} 顶层不是数组（实读 ${typeof raw}）`);
  if (raw.length === 0) throw new Error(`${label} 是空数组：没有分母，不算读数`);
  return raw.map((el, i) => {
    if (typeof el !== "object" || el === null) throw new Error(`${label}[${String(i)}] 不是对象`);
    const rec = el as Record<string, unknown>;
    const r = rec["r"];
    if (typeof r !== "object" || r === null) {
      throw new Error(`${label}[${String(i)}] 缺 r（期望 loop-eval 写出的 {r, g} 形状）`);
    }
    const rr = r as Record<string, unknown>;
    const g = rec["g"];
    const gOk = typeof g === "object" && g !== null ? (g as Record<string, unknown>)["ok"] : undefined;
    if (typeof gOk !== "boolean") {
      throw new Error(`${label}[${String(i)}] 缺 g.ok（判卷结果）——没有它就不该进分母`);
    }
    const id = rr["id"];
    if (typeof id !== "string" || id === "") throw new Error(`${label}[${String(i)}] 缺 r.id`);
    const res = (rr["resources"] ?? {}) as Record<string, unknown>;
    return {
      id,
      tokensIn: num(rr["tokensIn"], `${label}[${String(i)}].r.tokensIn`),
      tokensOut: num(rr["tokensOut"], `${label}[${String(i)}].r.tokensOut`),
      seconds: num(rr["seconds"], `${label}[${String(i)}].r.seconds`),
      rssPeakMb: typeof res["rssPeakMb"] === "number" ? res["rssPeakMb"] : 0,
      toolFailures: num(rr["toolFailures"], `${label}[${String(i)}].r.toolFailures`),
      repeats: num(rr["repeatedSameAction"], `${label}[${String(i)}].r.repeatedSameAction`),
      ok: gOk,
    };
  });
}

export function totalsOf(rows: readonly Row[]): Totals {
  const passed = rows.filter((r) => r.ok).length;
  const sum = (f: (r: Row) => number): number => rows.reduce((a, r) => a + f(r), 0);
  return {
    tasks: rows.length,
    passed,
    successRate: rows.length === 0 ? 0 : passed / rows.length,
    tokensIn: sum((r) => r.tokensIn),
    tokensOut: sum((r) => r.tokensOut),
    seconds: sum((r) => r.seconds),
    rssPeakMb: Math.max(0, ...rows.map((r) => r.rssPeakMb)),
    toolFailures: sum((r) => r.toolFailures),
    repeats: sum((r) => r.repeats),
  };
}

/** 一份读数里的任务集合（去重排序）。用于"分母是否同一个"这条护栏。 */
export function taskIds(rows: readonly Row[]): string[] {
  return [...new Set(rows.map((r) => r.id))].sort();
}

/** **噪声带**：同配置两次运行的逐指标绝对差。
 *
 *  它回答的是"什么都不改，两次跑能差多少"。改动幅度落在这个带里 ⇒ 判不出好坏。
 *  两点样本是弱证据，所以调用方**必须**把 `--baseline` 给两份以上；
 *  只有一份时本函数返回 null，`compare` 会把结论标成 unknown，而不是假装判得出。 */
export function noiseBand(a: Totals, b: Totals): Totals {
  const diff = (k: keyof Totals): number => Math.abs(a[k] - b[k]);
  return {
    tasks: diff("tasks"),
    passed: diff("passed"),
    successRate: diff("successRate"),
    tokensIn: diff("tokensIn"),
    tokensOut: diff("tokensOut"),
    seconds: diff("seconds"),
    rssPeakMb: diff("rssPeakMb"),
    toolFailures: diff("toolFailures"),
    repeats: diff("repeats"),
  };
}

function assess(metric: keyof Totals, delta: number): Assessment {
  if (delta === 0) return "noise";
  if (LOWER_IS_BETTER.has(metric)) return delta < 0 ? "better" : "worse";
  if (HIGHER_IS_BETTER.has(metric)) return delta > 0 ? "better" : "worse";
  return "unknown";
}

/** 逐指标对账。
 *
 *  `band` 为 null ⇒ 噪声带不可得（只给了一份基线），此时 `verdict` 一律 `unknown`——
 *  **不许**退化成"带内"：那正是"没量到当成通过"。 */
export function compare(
  baseline: Totals,
  candidate: Totals,
  band: Totals | null,
  baselineTasks: readonly string[],
  candidateTasks: readonly string[],
): Comparison {
  const sameTaskSet =
    baselineTasks.length === candidateTasks.length &&
    baselineTasks.every((id, i) => id === candidateTasks[i]);
  const lines: MetricLine[] = METRICS.map((metric) => {
    const delta = candidate[metric] - baseline[metric];
    const b = band === null ? null : band[metric];
    const verdict: Verdict | "unknown" =
      b === null ? "unknown" : Math.abs(delta) > b ? "beyond-noise" : "within-noise";
    return {
      metric,
      baseline: baseline[metric],
      candidate: candidate[metric],
      delta,
      band: b,
      verdict,
      assessment: verdict === "unknown" ? "unknown" : verdict === "within-noise" ? "noise" : assess(metric, delta),
    };
  });
  return { sameTaskSet, baselineTasks: [...baselineTasks], candidateTasks: [...candidateTasks], lines };
}

/** 单份读数的取值（多个基线文件取逐指标均值，让"噪声带"有个中心）。 */
export function meanTotals(all: readonly Totals[]): Totals {
  if (all.length === 0) throw new Error("meanTotals：空数组");
  const avg = (f: (t: Totals) => number): number => all.reduce((a, t) => a + f(t), 0) / all.length;
  return {
    tasks: avg((t) => t.tasks),
    passed: avg((t) => t.passed),
    successRate: avg((t) => t.successRate),
    tokensIn: avg((t) => t.tokensIn),
    tokensOut: avg((t) => t.tokensOut),
    seconds: avg((t) => t.seconds),
    rssPeakMb: avg((t) => t.rssPeakMb),
    toolFailures: avg((t) => t.toolFailures),
    repeats: avg((t) => t.repeats),
  };
}

const LABEL: Readonly<Record<keyof Totals, string>> = {
  tasks: "任务数",
  passed: "达标数",
  successRate: "成功率",
  tokensIn: "输入 token",
  tokensOut: "输出 token",
  seconds: "墙钟(秒)",
  rssPeakMb: "内存峰(MB)",
  toolFailures: "工具失败",
  repeats: "重复动作",
};

function fmt(metric: keyof Totals, v: number): string {
  if (metric === "successRate") return `${(v * 100).toFixed(1)}%`;
  if (metric === "seconds") return v.toFixed(1);
  return String(Math.round(v));
}

/** 渲染成人看的对照表。`band` 未知时**明说判不出**，不给假结论。 */
export function renderReport(cmp: Comparison, bandSource: string): string {
  const out: string[] = [];
  out.push(`噪声带来源：${bandSource}`);
  if (!cmp.sameTaskSet) {
    out.push("");
    out.push("❌ **任务集不一致 ⇒ 逐指标结论全部作废**（分母变了，横比无意义）");
    out.push(`   基线：${cmp.baselineTasks.join(", ")}`);
    out.push(`   改动：${cmp.candidateTasks.join(", ")}`);
    return out.join("\n");
  }
  out.push(`任务集一致（${String(cmp.baselineTasks.length)} 条）✅`);
  out.push("");
  out.push("指标          基线        改动        差值       噪声带      判定");
  for (const l of cmp.lines) {
    const bandTxt = l.band === null ? "不可得" : fmt(l.metric, l.band);
    const verdictTxt =
      l.verdict === "unknown" ? "判不出" : l.verdict === "within-noise" ? "带内" : l.assessment === "better" ? "★改善" : "⚠退化";
    out.push(
      `${LABEL[l.metric].padEnd(12)}  ${fmt(l.metric, l.baseline).padStart(10)}  ${fmt(l.metric, l.candidate).padStart(10)}  ` +
        `${fmt(l.metric, l.delta).padStart(9)}  ${bandTxt.padStart(9)}  ${verdictTxt}`,
    );
  }
  out.push("");
  const beyond = cmp.lines.filter((l) => l.verdict === "beyond-noise");
  if (cmp.lines.every((l) => l.verdict === "unknown")) {
    out.push("⚠ 噪声带不可得（只给了一份基线）⇒ **判不出改动的效果**。请把同一配置多跑一份喂 --baseline。");
  } else if (beyond.length === 0) {
    out.push("结论：所有指标都在噪声带内 ⇒ **这次改动没有可观测效果**（别声称变好了）。");
  } else {
    const better = beyond.filter((l) => l.assessment === "better");
    const worse = beyond.filter((l) => l.assessment === "worse");
    out.push(
      `结论：${String(beyond.length)} 项超出噪声带 —— 改善 ${String(better.length)} 项（${better.map((l) => LABEL[l.metric]).join("、") || "无"}）；` +
        `退化 ${String(worse.length)} 项（${worse.map((l) => LABEL[l.metric]).join("、") || "无"}）`,
    );
  }
  out.push("");
  out.push("读法：噪声带 = **同配置两次运行**的差。改动幅度落在带内 ⇒ 判不出好坏，不许当成功。");
  out.push("      两点样本是弱证据：要下结论请提高 --reps 并多喂几份 --baseline。");
  return out.join("\n");
}

/** 从 argv 取一个可重复的 flag（`--baseline a --baseline b`）。 */
function pickAll(argv: readonly string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag) out.push(argv[i + 1] ?? "");
  return out.filter((s) => s !== "");
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("report.ts")) {
  const argv = process.argv.slice(2);
  const basePaths = pickAll(argv, "--baseline");
  const candPaths = pickAll(argv, "--candidate");
  if (basePaths.length === 0 || candPaths.length === 0) {
    process.stderr.write(
      "用法：node --import tsx scripts/eval/report.ts --baseline <readings.json> [--baseline <再来一份同配置的>] --candidate <readings.json>\n" +
        "  噪声带需要**两份同配置**的基线；只给一份会把结论标成「判不出」。\n",
    );
    process.exit(2);
  }
  const baseRows = basePaths.map((p) => parseReadings(readFileSync(p, "utf8"), p));
  const candRows = candPaths.map((p) => parseReadings(readFileSync(p, "utf8"), p));
  const baseTotals = baseRows.map((r) => totalsOf(r));
  const candTotals = candRows.map((r) => totalsOf(r));
  const band = baseTotals.length >= 2 ? noiseBand(baseTotals[0]!, baseTotals[1]!) : null;
  const bandSource =
    baseTotals.length >= 2
      ? `${basePaths[0] ?? ""} ↔ ${basePaths[1] ?? ""}（同配置两次）`
      : `不可得：只给了 ${String(baseTotals.length)} 份基线`;
  const cmp = compare(
    meanTotals(baseTotals),
    meanTotals(candTotals),
    band,
    taskIds(baseRows[0]!),
    taskIds(candRows[0]!),
  );
  process.stdout.write(renderReport(cmp, bandSource) + "\n");
}
