// 每前进一份花多少钱（cost per progress）。
//
// 为什么要单独立一层：外部唯一量过的数是 SWE-Effi 的「未解决的尝试平均消耗 >4× 于成功尝试」
// （expensive failures），但**没有任何公开来源**给出「最后一次前进之后又花了多少」这个数——
// 而那恰恰是 stop-policy 唯一该切的对象。本仓两只手早就齐了却从没Meet过：
// `economics.deriveProgressBoundaries`（可信前进边界，只用于压缩选点）与 `usage` 事件（逐请求 token）。
//
// 第一次把两只手放到同一个读数上，就抓到一处**单位不一致**（实测，见
// outputs/cost-per-progress-2026-09-23/）：前进边界按定义只算主面（worker 事件不得闭合主流配对），
// 而把整跑 usage 直接求和的分子里含 worker 开销——fanout/supervise 那种形状上，
// 27 条 usage 里 20 条带 agent_id。这种比值不是"贵"，是**分子分母不同面**，任何按它做的
// 停止决策都会把"多花了一个 worker"读成"没有前进"。⇒ 本模块的第一条纪律：
// **分子只取与分母同一面，被排除的那部分必须显式列出来**（省了谁必须说出去）。
//
// 第二条纪律：**没有前进边界就是"不可测"，不是 0、也不是 Infinity**。把 unmeasurable 悄悄
// 当成"成本无穷大"或"没花钱"，是把一个统计缺口读成一个事实。

import { deriveProgressBoundaries } from "./economics";
import type { AgentEvent } from "../events";

export interface AttributionSplit {
  /** 主面（无 agent_id）的 input+output token 合计——与分母同面。 */
  mainTokens: number;
  /** 被排除的 worker 面开销（按 agent 归因），逐条列出，不并进比值。 */
  workerTokens: number;
  byAgent: Readonly<Record<string, number>>;
  /** 全量（main+worker），只为让读数可对照，不参与 tokensPerBoundary。 */
  totalTokens: number;
  cacheReadTokens: number;
  requests: number;
}

const tokOf = (e: { inputTokens?: number; outputTokens?: number }) => (e.inputTokens ?? 0) + (e.outputTokens ?? 0);

/** 按归属拆用量。`agent_id` 的语义照事件面既有约定：缺省 = 主 loop。 */
export function splitUsageByAttribution(events: readonly AgentEvent[]): AttributionSplit {
  let mainTokens = 0, workerTokens = 0, total = 0, cacheRead = 0, requests = 0;
  const byAgent: Record<string, number> = {};
  for (const e of events) {
    if (e.type !== "usage") continue;
    requests++;
    const t = tokOf(e);
    total += t;
    cacheRead += e.cacheReadInputTokens ?? 0;
    const agent = e.agent_id;
    if (agent === undefined) mainTokens += t;
    else {
      workerTokens += t;
      byAgent[agent] = (byAgent[agent] ?? 0) + t;
    }
  }
  return { mainTokens, workerTokens, byAgent, totalTokens: total, cacheReadTokens: cacheRead, requests };
}

export interface CostPerProgress {
  /** false ⇒ 这个比值今天不可判，`reason` 说清为什么（不许用 0 或 Infinity 顶替）。 */
  measurable: boolean;
  reason: "no-usage" | "no-progress-boundary" | null;
  /** 分母：主面的 verified 边界数（user 边界不算前进——那只是有人说了话）。 */
  verifiedBoundaries: number;
  /** 分母侧一并报出的 user 边界，读数时用来区分"没人说话"与"做了事没验过"。 */
  userBoundaries: number;
  mainTokens: number;
  /** 与比值无关但必须看得见：被排除的 worker 面开销。 */
  excludedWorkerTokens: number;
  tokensPerBoundary: number | null;
  /** 最后一次 verified 边界之后仍在花的 token（死跑成本的直接读数）。 */
  spendAfterLastBoundary: number;
  lastBoundaryEventId: number | null;
}

/** 成本 ÷ 前进。分子分母同取主面；worker 开销单列不参与。 */
export function costPerProgress(events: readonly AgentEvent[]): CostPerProgress {
  const split = splitUsageByAttribution(events);
  const boundaries = deriveProgressBoundaries(events);
  const verified = boundaries.filter((b) => b.kind === "verified");
  const lastId = verified.length > 0 ? verified[verified.length - 1]!.tailStart : null;
  // 位置而不是字段：tailStart 是 1-based 事件号，数组下标 0-based。
  let after = 0;
  events.forEach((e, i) => {
    if (e.type === "usage" && (lastId === null || i + 1 > lastId)) {
      const u = e as Extract<AgentEvent, { type: "usage" }>;
      if (u.agent_id === undefined) after += tokOf(u);
    }
  });
  if (split.requests === 0) {
    return {
      measurable: false, reason: "no-usage", verifiedBoundaries: verified.length,
      userBoundaries: boundaries.length - verified.length, mainTokens: 0,
      excludedWorkerTokens: split.workerTokens, tokensPerBoundary: null,
      spendAfterLastBoundary: 0, lastBoundaryEventId: lastId,
    };
  }
  if (verified.length === 0) {
    return {
      measurable: false, reason: "no-progress-boundary", verifiedBoundaries: 0,
      userBoundaries: boundaries.length, mainTokens: split.mainTokens,
      excludedWorkerTokens: split.workerTokens, tokensPerBoundary: null,
      spendAfterLastBoundary: split.mainTokens, lastBoundaryEventId: null,
    };
  }
  return {
    measurable: true, reason: null,
    verifiedBoundaries: verified.length,
    userBoundaries: boundaries.length - verified.length,
    mainTokens: split.mainTokens,
    excludedWorkerTokens: split.workerTokens,
    tokensPerBoundary: Math.round(split.mainTokens / verified.length),
    spendAfterLastBoundary: after,
    lastBoundaryEventId: lastId,
  };
}

export interface RunRow {
  id: string;
  /** 结局取自事件面（最后一条 verify_result 的 ok），不取自散文。 */
  outcome: "green" | "red" | "unknown";
  cost: CostPerProgress;
}

/** 均值只从**可测**的那些跑里取——把不可测的当 0 或直接丢进分母都是读数造假。 */
export function meanCostPerBoundary(rows: readonly RunRow[]): { mean: number | null; used: number; skipped: string[] } {
  const usable = rows.filter((r) => r.cost.measurable && r.cost.tokensPerBoundary !== null);
  const skipped = rows.filter((r) => !r.cost.measurable).map((r) => r.id + ":" + String(r.cost.reason));
  if (usable.length === 0) return { mean: null, used: 0, skipped };
  return {
    mean: Math.round(usable.reduce((n, r) => n + (r.cost.tokensPerBoundary ?? 0), 0) / usable.length),
    used: usable.length,
    skipped,
  };
}

/** 分母体检：成功跑里有多少条根本取不到 verified 边界。
 *  这条判据要防的是**另一种**错：拿"边界=0"当"这条跑失败/没前进"的定论——
 *  实测 fanout/supervise 那种成功形状就是 0（worker 不闭合主流配对 ⇒ 按定义为 0）。
 *  ⇒ 报告必须把「不可测」与「零前进」分开写，且不可测的跑不得被并均值。 */
export function denominatorCoverage(rows: readonly RunRow[]): { ok: boolean; detail: string } {
  const green = rows.filter((r) => r.outcome === "green");
  const withBoundary = green.filter((r) => r.cost.verifiedBoundaries > 0);
  const zeroBoundaryGreen = green.filter((r) => r.cost.verifiedBoundaries === 0).map((r) => r.id);
  const redWithout = rows.filter((r) => r.outcome === "red" && r.cost.verifiedBoundaries === 0);
  const ok = green.length >= 2 && withBoundary.length >= 1 && redWithout.length >= 1;
  return {
    ok,
    detail: `成功跑 ${String(green.length)} 条：带 verified 边界 ${String(withBoundary.length)} 条、` +
      `取不到边界的 ${String(zeroBoundaryGreen.length)} 条${zeroBoundaryGreen.length ? "[" + zeroBoundaryGreen.join(",") + "]" : ""}` +
      `｜失败跑里 ${String(redWithout.length)} 条零前进（它们的整笔主面开销就是"死跑成本"，可点名）` +
      (withBoundary.length === 0 ? " ⇒ 分面全空：这条判据没有分辨力，判红" : "") +
      (redWithout.length === 0 ? " ⇒ 没有零前进的失败样本：也无分辨力，判红" : ""),
  };
}
