/**
 * 成本 ÷ 前进门（cost-per-progress）。
 *
 * 判的是**这只比值能不能被信**，不是"跑得好不好"：
 *  - 分子分母必须同面（前进边界按定义只算主面；worker 开销得被排除并且看得见）；
 *  - 没有前进边界必须落在"不可测"上，不许悄悄变成 0 或 Infinity；
 *  - 均值只能从可测样本取，被跳过的要点名；
 *  - 分母覆盖本身要有读数（成功跑里取不到边界的那几条是事实，不是噪声）。
 *
 * 语料分工：真实录制走 `fixtures/no-progress/real-*`（已冻结，NP5 钉着）；
 * 跨归属那一格真实语料里没有（录制要么全主面要么 worker 独立流），故在门内合成一份形状样本——
 * 它只喂纯函数，不进冻结面（合成物不是"事实"，冻结它会让人误以为那是录制）。
 *
 * 用法：`pnpm cost-per-progress-check`｜反向对照 `pnpm cost-per-progress-check -- --self-test`
 */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { replay } from "../src/events";
import type { AgentEvent } from "../src/events";
import {
  costPerProgress,
  denominatorCoverage,
  meanCostPerBoundary,
  splitUsageByAttribution,
  type RunRow,
} from "../src/agent/cost-per-progress";

const REAL_CORPUS: readonly { file: string; outcome: RunRow["outcome"] }[] = [
  { file: "real-green-read-edit-verify.events.jsonl", outcome: "green" },
  { file: "real-green-long-explore.events.jsonl", outcome: "green" },
  { file: "real-green-short-run.events.jsonl", outcome: "green" },
  { file: "real-red-verify-stagnation.events.jsonl", outcome: "red" },
];

export interface CpVerdict { ok: boolean; detail: string }

/** 合成形状样本：主面走完一次「验证 → 通过」，同时两个 worker 各花了一笔。 */
export function mixedAttributionFixture(): AgentEvent[] {
  const ev: Record<string, unknown>[] = [
    { type: "user_message", content: "让两个 worker 分头改" },
    { type: "usage", inputTokens: 1000, outputTokens: 200 },
    // 一次成功的写：verified 边界要「完成过工作 + 新的成功证据」，光有绿 verify 不闭合（实测）
    { type: "tool_call", id: "e1", name: "edit_file", args: { path: "src/a.ts" } },
    { type: "tool_result", callId: "e1", ok: true, output: "已改 1 行" },
    { type: "usage", inputTokens: 5000, outputTokens: 400, agent_id: "w1" },
    { type: "usage", inputTokens: 7000, outputTokens: 500, agent_id: "w2" },
    { type: "tool_call", id: "v1", name: "verify", args: {} },
    { type: "verify_result", callId: "v1", ok: true, attempt: 1, maxAttempts: 3, results: [{ command: "t", ok: true, output: "ok" }] },
    { type: "tool_result", callId: "v1", ok: true, output: "ok" },
    { type: "usage", inputTokens: 2000, outputTokens: 100 },
  ] as never;
  return ev as unknown as AgentEvent[];
}

/** CP1：分子只取主面，worker 开销被排除且被点名。 */
export function numeratorSharesDenominatorFace(split: ReturnType<typeof splitUsageByAttribution>, cost: ReturnType<typeof costPerProgress>): CpVerdict {
  const expectedMain = 1000 + 200 + 2000 + 100;
  const expectedWorker = 5000 + 400 + 7000 + 500;
  const ok = split.mainTokens === expectedMain && split.workerTokens === expectedWorker && cost.excludedWorkerTokens === expectedWorker;
  return {
    ok,
    detail: `主面 ${String(split.mainTokens)}（期望 ${String(expectedMain)}）、worker ${String(split.workerTokens)}` +
      `（期望 ${String(expectedWorker)}，且必须原样出现在 excludedWorkerTokens 里）｜比值=${String(cost.tokensPerBoundary)}`,
  };
}

/** CP2：比值与"前进"同面 ⇒ 每边界成本只能由主面算出。 */
export function ratioUsesOnlyMainFace(cost: ReturnType<typeof costPerProgress>): CpVerdict {
  const expected = Math.round((1000 + 200 + 2000 + 100) / Math.max(1, cost.verifiedBoundaries));
  return {
    ok: cost.measurable && cost.tokensPerBoundary === expected,
    detail: `tokensPerBoundary=${String(cost.tokensPerBoundary)}（期望 ${String(expected)} = 主面/边界数）；` +
      `若把 worker 算进来会是 ${String(Math.round((1000 + 200 + 2000 + 100 + 5000 + 400 + 7000 + 500) / Math.max(1, cost.verifiedBoundaries)))}——那才是本门要挡的那个错`,
  };
}

/** CP3：零前进 ⇒ 不可测（不是 0、不是 Infinity），且整笔主面开销点名成死跑成本。 */
export function zeroBoundaryIsUnmeasurable(cost: ReturnType<typeof costPerProgress>): CpVerdict {
  const ok = !cost.measurable && cost.reason === "no-progress-boundary" && cost.tokensPerBoundary === null &&
    cost.spendAfterLastBoundary === cost.mainTokens && cost.mainTokens > 0;
  return {
    ok,
    detail: `measurable=${String(cost.measurable)} reason=${String(cost.reason)} 比值=${String(cost.tokensPerBoundary)}` +
      `｜死跑成本=${String(cost.spendAfterLastBoundary)}（应等于主面总额 ${String(cost.mainTokens)}）`,
  };
}

/** CP4：均值只从可测样本取，跳过的必须点名。
 *  `got` 是**读数**而不是内部重算——上一格学到的那条：判据吃不到输入时，它的反向对照只能是自己证明自己绿。 */
export function meanSkipsUnmeasurable(rows: readonly RunRow[], got: { mean: number | null; used: number; skipped: string[] } = meanCostPerBoundary(rows)): CpVerdict {
  const m = got;
  const measurable = rows.filter((r) => r.cost.measurable);
  const expect = measurable.length === 0 ? null : Math.round(measurable.reduce((n, r) => n + (r.cost.tokensPerBoundary ?? 0), 0) / measurable.length);
  return {
    ok: m.mean === expect && m.used === measurable.length && m.skipped.length === rows.length - measurable.length,
    detail: `均值=${String(m.mean)}（期望 ${String(expect)}）用了 ${String(m.used)} 条、跳过 ${String(m.skipped.length)} 条` +
      `[${m.skipped.join(",")}]`,
  };
}

async function loadCorpus(): Promise<RunRow[]> {
  const out: RunRow[] = [];
  for (const one of REAL_CORPUS) {
    const events = (await replay(join("fixtures", "no-progress", one.file))) as unknown as AgentEvent[];
    out.push({ id: one.file.replace(".events.jsonl", ""), outcome: one.outcome, cost: costPerProgress(events) });
  }
  out.push({ id: "synth-mixed-attribution", outcome: "green", cost: costPerProgress(mixedAttributionFixture()) });
  out.push({ id: "synth-no-usage", outcome: "unknown", cost: costPerProgress([{ type: "user_message", content: "x" }] as unknown as AgentEvent[]) });
  return out;
}

export interface CpRules { id: string; why: string; run: () => Promise<CpVerdict> | CpVerdict }

export const COST_RULES: readonly CpRules[] = [
  {
    id: "CP1-分子只取与分母同的一面",
    why: "前进边界按定义只算主面（worker 事件不得闭合主流配对）。把整跑 usage 求和当分子，" +
      "在 fanout/supervise 那种形状上就是「多花了一个 worker」被读成「没有前进」——实测 27 条 usage 里 20 条带 agent_id",
    run: () => {
      const ev = mixedAttributionFixture();
      return numeratorSharesDenominatorFace(splitUsageByAttribution(ev), costPerProgress(ev));
    },
  },
  {
    id: "CP2-比值里不许混进 worker 开销",
    why: "同一份输入，两种算法差 2.4 倍。这条钉的是「数出来的那个数是谁」",
    run: () => ratioUsesOnlyMainFace(costPerProgress(mixedAttributionFixture())),
  },
  {
    id: "CP3-零前进是不可测不是 0 也不是 Infinity",
    why: "本仓那条真实红跑就是这形状：68,535 token、零 verified 边界。把它写成 Infinity 会让均值爆炸，" +
      "写成 0 会读成「没花钱」——两种都是把统计缺口当事实",
    run: async () => {
      const rows = await loadCorpus();
      const red = rows.find((r) => r.id.startsWith("real-red"));
      if (red === undefined) throw new Error("语料缺红跑");
      return zeroBoundaryIsUnmeasurable(red.cost);
    },
  },
  {
    id: "CP4-均值只从可测样本取且点名跳过",
    why: "分母体检：不可测的样本一旦并进均值（或被静默丢掉），「每前进一份花多少」就成了编的",
    run: async () => {
      const rows = await loadCorpus();
      const v = meanSkipsUnmeasurable(rows);
      const cov = denominatorCoverage(rows.filter((r) => r.id !== "synth-no-usage"));
      return { ok: v.ok && cov.ok, detail: v.detail + "｜" + cov.detail };
    },
  },
];

/** 反向对照：每只判据喂一件故意做错的工件。 */
export function runCpSelfTest(): { caught: string[]; missed: string[] } {
  const caught: string[] = [];
  const missed: string[] = [];
  const ev = mixedAttributionFixture();
  const cost = costPerProgress(ev);
  const probes: { id: string; predicateSaysRed: () => boolean }[] = [
    {
      // 把 worker 并进分子（本门要挡的那一只）
      id: "CP1-分子只取与分母同的一面",
      predicateSaysRed: () => !numeratorSharesDenominatorFace(
        { mainTokens: 1000 + 200 + 2000 + 100 + 5000 + 400 + 7000 + 500, workerTokens: 0, byAgent: {}, totalTokens: 0, cacheReadTokens: 0, requests: 0 },
        { ...cost, excludedWorkerTokens: 0 },
      ).ok,
    },
    {
      id: "CP2-比值里不许混进 worker 开销",
      predicateSaysRed: () => !ratioUsesOnlyMainFace({ ...cost, tokensPerBoundary: Math.round((1600 + 5400 + 7500) / Math.max(1, cost.verifiedBoundaries)) }).ok,
    },
    {
      id: "CP3-零前进是不可测（写成 0 成本即红）",
      predicateSaysRed: () => !zeroBoundaryIsUnmeasurable({
        measurable: true, reason: null, verifiedBoundaries: 0, userBoundaries: 1, mainTokens: 68535,
        excludedWorkerTokens: 0, tokensPerBoundary: 0, spendAfterLastBoundary: 0, lastBoundaryEventId: null,
      }).ok,
    },
    {
      id: "CP4-均值把不可测的算进去",
      predicateSaysRed: () => {
        const rows = [
          { id: "g", outcome: "green" as const, cost: { measurable: true, reason: null, verifiedBoundaries: 1, userBoundaries: 1, mainTokens: 1000, excludedWorkerTokens: 0, tokensPerBoundary: 1000, spendAfterLastBoundary: 0, lastBoundaryEventId: 5 } },
          { id: "r", outcome: "red" as const, cost: { measurable: false, reason: "no-progress-boundary" as const, verifiedBoundaries: 0, userBoundaries: 1, mainTokens: 9000, excludedWorkerTokens: 0, tokensPerBoundary: null, spendAfterLastBoundary: 9000, lastBoundaryEventId: null } },
        ];
        // 一只"把不可测的也算进均值、且没点名跳过"的读数 ⇒ 必须红
        return !meanSkipsUnmeasurable(rows, { mean: 5000, used: 2, skipped: [] }).ok;
      },
    },
    {
      id: "CP4-分母覆盖（成功跑全取不到边界即无分辨力）",
      predicateSaysRed: () => !denominatorCoverage([
        { id: "a", outcome: "green", cost: { measurable: false, reason: "no-progress-boundary", verifiedBoundaries: 0, userBoundaries: 1, mainTokens: 1, excludedWorkerTokens: 0, tokensPerBoundary: null, spendAfterLastBoundary: 1, lastBoundaryEventId: null } },
        { id: "b", outcome: "green", cost: { measurable: false, reason: "no-progress-boundary", verifiedBoundaries: 0, userBoundaries: 1, mainTokens: 1, excludedWorkerTokens: 0, tokensPerBoundary: null, spendAfterLastBoundary: 1, lastBoundaryEventId: null } },
      ]).ok,
    },
  ];
  for (const p of probes) {
    let red = false;
    try {
      red = p.predicateSaysRed();
    } catch {
      red = false;
    }
    (red ? caught : missed).push(p.id);
  }
  return { caught, missed };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--self-test")) {
    const r = runCpSelfTest();
    console.log(`[cost-per-progress-check] --self-test：造得红 ${String(r.caught.length)}/${String(r.caught.length + r.missed.length)}`);
    for (const id of r.caught) console.log(`  ✅ 造得红 ${id}`);
    for (const id of r.missed) console.log(`  ❌ 造不红 ${id} —— 这条判据是摆设`);
    process.exit(r.missed.length === 0 ? 0 : 1);
  }
  let failed = 0;
  for (const rule of COST_RULES) {
    let v: CpVerdict;
    try {
      v = await rule.run();
    } catch (err) {
      v = { ok: false, detail: "抛异常：" + (err instanceof Error ? err.message : String(err)) };
    }
    if (!v.ok) failed++;
    console.log(`  ${v.ok ? "✅" : "❌"} ${rule.id} — ${v.detail}`);
    if (!v.ok) console.log(`     为什么要有这条：${rule.why}`);
  }
  console.log(failed === 0 ? `[cost-per-progress-check] ${String(COST_RULES.length)}/${String(COST_RULES.length)} 通过` : `[cost-per-progress-check] ❌ ${String(failed)} 条不过`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void main();
}
