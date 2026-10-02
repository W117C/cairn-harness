// 符号地图·渲染与预算（§6.4）：按文件聚合、树形缩略（TreeContext 风格）、单行截断 100 字符；
// 预算二分（默认 1024 token，夹在 [1024, 4096]，上限 = 模型输入上限/8），前缀渲染计 token、
// 误差 <0.15 早停。token 估算复用 compaction 的 estimateTokens（chars/4，零 tokenizer 依赖）。
import { estimateTokens } from "../compaction.js";
import type { BuiltGraph } from "./rank.js";
import { rankedNodes, type MapNode } from "./rank.js";

export const MAP_TOKENS_DEFAULT = 1024;
export const MAP_TOKENS_MIN = 1024;
export const MAP_TOKENS_MAX = 4096;
const LINE_CHAR_CAP = 100;

/** 预算参数归一：先夹进 [1024, 4096]，再与上限 = maxInput/8 取小（**取小后不回弹**）。
 *  E10（审查 P3）：旧实现先 /8 收紧再 max(MIN, b) 回弹——输入上限 < 8192 时实际预算
 *  突破声明的 /8 帽。冲突时 /8 帽优先（显式语义）。 */
/** 一段文本在**地图这一侧**值多少 token：与二分渲染用的是同一支估算（chars/4）。
 *  为什么要导出：检索行那类"地图之外、注入之内"的文本也要从同一个帽里扣，
 *  自己再写一份估算就是第二把尺（同族：两处同族判据宽度不同）。 */
export function mapTokensOf(text: string): number {
  return text === "" ? 0 : estimateTokens(text.length);
}

export function clampBudget(requested: number | undefined, maxInputTokens?: number): number {
  let b = requested ?? MAP_TOKENS_DEFAULT;
  b = Math.min(MAP_TOKENS_MAX, Math.max(MAP_TOKENS_MIN, b));
  if (maxInputTokens !== undefined) b = Math.min(b, Math.floor(maxInputTokens / 8));
  return b;
}

function truncateLine(s: string): string {
  return s.length > LINE_CHAR_CAP ? s.slice(0, LINE_CHAR_CAP - 1) + "…" : s;
}

/** 取排名前 k 的节点渲染（按文件聚合、树形缩略、单行截断）。纯函数。 */
export function renderNodes(nodes: MapNode[]): string {
  if (nodes.length === 0) return "";
  const byFile = new Map<string, MapNode[]>();
  for (const n of nodes) {
    let list = byFile.get(n.file);
    if (!list) {
      list = [];
      byFile.set(n.file, list);
    }
    list.push(n);
  }
  const lines: string[] = [];
  for (const [file, list] of byFile) {
    lines.push(truncateLine(file));
    for (const n of [...list].sort((a, b) => a.line - b.line)) {
      lines.push(truncateLine(`│ ${String(n.line)} ${n.kind} ${n.name}`));
    }
  }
  return lines.join("\n");
}

export interface RenderResult {
  text: string;
  /** 估算 token（chars/4）。 */
  tokens: number;
  /** 进入渲染的节点数（map-check 断言输出随预算变化用）。 */
  included: number;
}

/**
 * 预算二分：排名降序取前 k 个节点渲染，找 tokens(k) ≤ budget 的最大 k。
 * 候选命中 |tokens-budget|/budget < 0.15 即早停（aider pct_err 同款）。
 */
export function renderMapBudget(g: BuiltGraph, ranks: number[], budgetTokens: number, factor = 4): RenderResult {
  const ranked = rankedNodes(g, ranks);
  const tokensOf = (k: number): number => estimateTokens(renderNodes(ranked.slice(0, k)).length, factor);
  if (ranked.length === 0 || tokensOf(1) > budgetTokens) {
    return { text: "", tokens: 0, included: 0 };
  }
  let lo = 1;
  let hi = ranked.length; // tokens(hi) 可能超预算；lo 一定 ≤ 预算（tokens(1) 已验）
  let bestK = 1;
  let bestTokens = tokensOf(1);
  if (bestTokens > 0 && Math.abs(bestTokens - budgetTokens) / budgetTokens < 0.15) {
    return { text: renderNodes(ranked.slice(0, 1)), tokens: bestTokens, included: 1 };
  }
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = tokensOf(mid);
    if (t <= budgetTokens) {
      bestK = mid;
      bestTokens = t;
      if (t > 0 && Math.abs(t - budgetTokens) / budgetTokens < 0.15) break; // 误差 <0.15 早停
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { text: renderNodes(ranked.slice(0, bestK)), tokens: bestTokens, included: bestK };
}
