// 自进化账本（闭环 v2 · 批次 A1）：把「发出过什么补丁、后来怎么样了」从**单记录覆盖**改成
// 追加式事件账 `<workspace>/.agent/evolution-ledger.jsonl`。
//
// 为什么需要（2026-10-25 立案）：旧实现每轮整文件覆盖 `.agent/evolution.json`，只留最近一轮——
// 同一条补丁「发出 → 看似消解 → 再复发」的振荡在账面上不可见（没有第 N 次复发的计数），
// patch-effect 判「复发 vs 消解」永远只有一轮样本。GEPA 的候选池靠族谱与历史避免重复失败尝试；
// 这里的账本就是补丁的族谱：emit 记发出、observe 记每轮评估结论，投影折出每条 key 的
// 发出数 / 消解数 / 复发数 / 复发连击，复发连击 ≥2 时渲染层自动升级措辞（见 escalateNote）。
//
// 纪律（沿 registry.ts 的账本族）：
//  · **追加式 JSONL 为事实源**：一行一条事件，`appendFile`（O_APPEND 单写）落账；
//    不整文件重写 ⇒ 不存在「后写者带旧全文盖掉先写者」的窗口（store.ts appendRootFile 同款）。
//  · **坏行只丢那一条**：读侧逐行 parse，认不出的行跳过并计数——不整账作废（M7 二审的同一裁决：
//    坏索引行只丢那一条，防整段注入打不可用）；也不静默：`loadLedger` 把坏行数报给调用方出声。
//  · **投影可重建**：`projectLedger` 是纯 fold，账本删了重建同一份投影；投影不落盘
//    （每次现折——账本行数有界：每轮 ≤ 1 run + 2×补丁数 行）。
//  · **evolution.json 不动**：它仍是「下一轮装配面」的读料（prompt 渲染走它，逐字兼容）；
//    账本只补「跨轮统计」这一格。两份写都发生在 index.ts 的 withEvolutionLock 串行段里。

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PatchEffectStatus } from "./patch-effect";
import type { StrategyPatch } from "./strategy-patch";
import { patchKeyOf } from "./patch-effect";
import { isRecord } from "../../is-record";

export const EVOLUTION_LEDGER_FILE = "evolution-ledger.jsonl";

export function evolutionLedgerPathFor(workspace: string): string {
  return join(workspace, ".agent", EVOLUTION_LEDGER_FILE);
}

/** 账本事件（一行一条；`v` 在行首做版本门）。
 *  run 事件带成本读数（可测时的 tokensPerBoundary）：canary 观察期的 cost-per-progress 基线
 *  从这份历史折中位数（assess.ts 取料）——比「拍一个数」诚实，比「每次现测」稳。 */
export type LedgerEvent =
  | { v: 1; type: "run"; ts: number; session?: string; verifyOutcome: "green" | "red" | "none"; patches: number; tokensPerBoundary?: number | null; costMeasurable?: boolean }
  | { v: 1; type: "emit"; ts: number; key: string; kind: StrategyPatch["kind"]; note: string }
  | { v: 1; type: "observe"; ts: number; key: string; status: PatchEffectStatus; observed: string };

/** 单行 parse + 验形状。认不出 ⇒ null（调用方按「坏行只丢这一条」处置）。 */
export function parseLedgerLine(line: string): LedgerEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (raw.type === "run") {
    if (typeof raw.ts !== "number" || !Number.isFinite(raw.ts)) return null;
    if (raw.verifyOutcome !== "green" && raw.verifyOutcome !== "red" && raw.verifyOutcome !== "none") return null;
    if (typeof raw.patches !== "number" || !Number.isFinite(raw.patches)) return null;
    if (raw.session !== undefined && typeof raw.session !== "string") return null;
    if (raw.tokensPerBoundary !== undefined && raw.tokensPerBoundary !== null && (typeof raw.tokensPerBoundary !== "number" || !Number.isFinite(raw.tokensPerBoundary))) return null;
    if (raw.costMeasurable !== undefined && typeof raw.costMeasurable !== "boolean") return null;
    return {
      v: 1, type: "run", ts: raw.ts, ...(raw.session !== undefined ? { session: raw.session } : {}),
      verifyOutcome: raw.verifyOutcome, patches: raw.patches,
      ...(raw.tokensPerBoundary !== undefined ? { tokensPerBoundary: raw.tokensPerBoundary } : {}),
      ...(raw.costMeasurable !== undefined ? { costMeasurable: raw.costMeasurable } : {}),
    };
  }
  if (raw.type === "emit") {
    if (typeof raw.ts !== "number" || typeof raw.key !== "string" || typeof raw.note !== "string") return null;
    if (raw.kind !== "verify-escalate" && raw.kind !== "goal-reconfirm" && raw.kind !== "cost-throttle") return null;
    return { v: 1, type: "emit", ts: raw.ts, key: raw.key, kind: raw.kind, note: raw.note };
  }
  if (raw.type === "observe") {
    if (typeof raw.ts !== "number" || typeof raw.key !== "string" || typeof raw.observed !== "string") return null;
    if (raw.status !== "resolved" && raw.status !== "recurred" && raw.status !== "inconclusive") return null;
    return { v: 1, type: "observe", ts: raw.ts, key: raw.key, status: raw.status, observed: raw.observed };
  }
  return null;
}

export interface LoadedLedger {
  events: LedgerEvent[];
  /** 认不出被跳过的行数（调用方出声用——静默丢行会把「账读不全」折成「账就这么长」）。 */
  badLines: number;
}

/** 读整份账本。文件缺失 = 空账（首启正常）；坏行只丢那一条并计数。 */
export async function loadLedger(workspace: string): Promise<LoadedLedger> {
  let raw: string;
  try {
    raw = await readFile(evolutionLedgerPathFor(workspace), "utf8");
  } catch {
    return { events: [], badLines: 0 };
  }
  const events: LedgerEvent[] = [];
  let badLines = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const parsed = parseLedgerLine(line);
    if (parsed === null) badLines += 1;
    else events.push(parsed);
  }
  return { events, badLines };
}

/** 追加事件（一行一条）。目录缺了顺手建；写失败由调用方处置（不许阻塞主流程）。 */
export async function appendLedger(workspace: string, events: readonly LedgerEvent[]): Promise<void> {
  if (events.length === 0) return;
  const dir = join(workspace, ".agent");
  await mkdir(dir, { recursive: true });
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await appendFile(evolutionLedgerPathFor(workspace), body, "utf8");
}

/** 一条补丁 key 的跨轮统计（projectLedger 的投影格）。 */
export interface LedgerKeyStats {
  key: string;
  kind: StrategyPatch["kind"];
  /** 历史发出次数。 */
  emitted: number;
  resolved: number;
  recurred: number;
  inconclusive: number;
  /** **当前**复发连击：最近一次 observe 是 recurred 起算的连续 recurred 次数——
   *  中间夹一次 resolved/inconclusive 即清零。这是「第 N 次复发」升级措辞的依据。 */
  recurrenceStreak: number;
  lastStatus: PatchEffectStatus | null;
  lastTs: number;
}

export interface LedgerProjection {
  stats: Record<string, LedgerKeyStats>;
  /** 账本里 run 事件数（= 有记录的收束轮数）。 */
  runs: number;
  lastRunTs: number | null;
  /** 最近的 tokensPerBoundary 读数（可测的那些，旧→新；封顶最近 20 条）——canary 基线的取料面。 */
  recentTokensPerBoundary: number[];
}

/** 纯 fold：事件账 ⇒ 每 key 统计。fold 顺序即账本顺序（追加序）；同 key 乱序不可能出现
 *  （emit/observe 都在锁内串行落账）。空账 ⇒ 空投影（零行为）。 */
export function projectLedger(events: readonly LedgerEvent[]): LedgerProjection {
  const stats: Record<string, LedgerKeyStats> = {};
  let runs = 0;
  let lastRunTs: number | null = null;
  const recentTokensPerBoundary: number[] = [];
  for (const e of events) {
    if (e.type === "run") {
      runs += 1;
      lastRunTs = e.ts;
      if (typeof e.tokensPerBoundary === "number" && Number.isFinite(e.tokensPerBoundary)) {
        recentTokensPerBoundary.push(e.tokensPerBoundary);
        if (recentTokensPerBoundary.length > 20) recentTokensPerBoundary.shift();
      }
      continue;
    }
    if (e.type === "emit") {
      const cur = stats[e.key] ?? { key: e.key, kind: e.kind, emitted: 0, resolved: 0, recurred: 0, inconclusive: 0, recurrenceStreak: 0, lastStatus: null, lastTs: 0 };
      cur.emitted += 1;
      cur.kind = e.kind;
      cur.lastTs = e.ts;
      stats[e.key] = cur;
      continue;
    }
    // observe：折三态结论；复发连击只在「连续 recurred」上累加，resolved/inconclusive 都打断。
    const cur = stats[e.key];
    if (cur === undefined) continue; // 没发出过就有观察 ⇒ 旧账残段，不编造 emit 计数
    if (e.status === "resolved") {
      cur.resolved += 1;
      cur.recurrenceStreak = 0;
    } else if (e.status === "recurred") {
      cur.recurred += 1;
      cur.recurrenceStreak += 1;
    } else {
      cur.inconclusive += 1;
    }
    cur.lastStatus = e.status;
    cur.lastTs = e.ts;
  }
  return { stats, runs, lastRunTs, recentTokensPerBoundary };
}

/** 复发升级阈值：连击 ≥2（= 同一问题隔着轮次又犯了两回）才在措辞前加「第 N 次复发」——
 *  第一次复发读起来本就该警觉，第二次起才有「又来了」的信息量。 */
export const RECURRENCE_ESCALATE_MIN_STREAK = 2;

/** 用账本统计升级补丁措辞（纯函数）：复发连击过线 ⇒ note 前加「（第 N 次复发）」；
 *  没过线或无账 ⇒ note 原样返回（零行为）。 */
export function escalateNote(note: string, stats: LedgerKeyStats | undefined): string {
  if (stats === undefined || stats.recurrenceStreak < RECURRENCE_ESCALATE_MIN_STREAK) return note;
  return "（第 " + String(stats.recurrenceStreak) + " 次复发）" + note;
}

/** 本轮要落账的事件集（纯函数）：run 一条（带成本读数）+ 每条补丁 emit + 每条效果 observe。
 *  emit 落的是**升级后**的 note（账面与下一轮读到的措辞一致，审计不打架）。 */
export function ledgerEventsFor(
  ts: number,
  fromSession: string | undefined,
  signals: { verifyOutcome: "green" | "red" | "none"; tokensPerBoundary: number | null; costMeasurable: boolean },
  patches: readonly StrategyPatch[],
  effects: readonly { key: string; status: PatchEffectStatus; observed: string }[],
): LedgerEvent[] {
  const out: LedgerEvent[] = [{
    v: 1, type: "run", ts,
    ...(fromSession !== undefined ? { session: fromSession } : {}),
    verifyOutcome: signals.verifyOutcome, patches: patches.length,
    tokensPerBoundary: signals.tokensPerBoundary, costMeasurable: signals.costMeasurable,
  }];
  for (const p of patches) {
    out.push({ v: 1, type: "emit", ts, key: patchKeyOf(p), kind: p.kind, note: p.note });
  }
  for (const e of effects) {
    out.push({ v: 1, type: "observe", ts, key: e.key, status: e.status, observed: e.observed });
  }
  return out;
}

/** 中位数（canary 基线取料用）：空数组 ⇒ null（没读数不编基线——同「不可测 ≠ 0」的纪律）。 */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
