// 符号地图·渲染与预算（§6.4）：按文件聚合、树形缩略（TreeContext 风格）、单行截断 100 字符；
// 预算二分（默认 1024 token，夹在 [1024, 4096]，上限 = 模型输入上限/8），前缀渲染计 token、
// 误差 <0.15 早停。token 估算复用 compaction 的 estimateTokens（chars/4，零 tokenizer 依赖）。
//
// ⚠️ 三个常量分三种身份，读错就会得出错的「生产值」：`MAP_TOKENS_DEFAULT`（1024）才是生产实际值
// （`session-provider.ts` 的调用点已把它显式传成 `budgetTokens`）；`MAP_TOKENS_MIN`（1024）是下限夹取；
// `MAP_TOKENS_MAX`（4096）是**上限**——只有显式请求更大预算时才可能取到，生产**从未取到过**。
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
 *  自己再写一份估算就是第二把尺（同族：两处同族判据宽度不同）。
 *
 *  ⚠️ **为什么这一处用 chars/4 而不用 `text-budget.ts` 的 CJK 感知 `estimateTextTokens`**：
 *  本仓别处反复说「chars/4 对中文低估 3–4 倍」（`model-surface.ts` 文件头、`text-budget.ts` 文件头），
 *  读到这里很容易判定这是同一个缺陷、该换掉。**它不是。** 地图注入的是**文件路径与符号名**，
 *  2026-10-03 在本仓工作区实测三组问句（含纯中文问句），产出文本 3,973–3,988 字符里宽字符
 * **只占 1.7%**：chars/4 读 994–997 tok，CJK 感知读 1,045–1,049 tok，**实际只差 5.2%**。
 *  换成 CJK 感知只会让每张地图缩水约 5%，换不到任何准确度，还会牵动二分渲染的收敛判据。
 *  那个 3–4 倍的警告对**散文块**成立（记忆注入、skill 重挂、hook 上下文——它们确实用
 *  `text-budget.ts` 那把尺），对**地图这一族不成立**。别把这三族混着算。 */
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
