// 并行 worker 语义冲突雷达（2026-11-12，第 1074 页）：把 impact 符号图从「spawn 时点的文件级波及」
// 再往下用一层——worker 落地时按 **diff hunk 行区间 × 站点行号** 求交，报「谁改了哪个符号、
// 谁在消费它」的带方向清单。git 只隔离文本冲突，语义冲突（各改各的文件、却动同一批符号）它看不见。
//
// 三条口径（都是判据的一部分，别在调用点各抄一份）：
//   ① **纯函数**：建图/读 diff 的 IO 全在调用方（worker-merge 的合并塔），这里只吃 ImpactGraph；
//      ImpactGraph.defs/refs 的站点自带 1-based 行号，hunk 解析同用 1-based ⇒ 求交不换算。
//   ② **宁多勿漏**：没有 hunk 信息的一侧按整文件全量 def 算（照 `fileImpact` 的保守口径）。
//      worker 侧的改动面只有 changedPaths 文件集（不追每笔 hunk），故对方一律整文件。
//   ③ **v1 只让 same-symbol 拦合并**：cross-consumer 依赖 upward 的归属判据，误报风险高，
//      只发告警消息（agent_message{kind:"progress"}，零新事件类型——ADR 0005）。
import type { ImpactGraph, ImpactSite } from "./impact/index";
import { upward } from "./impact/index";

/** 1-based 闭区间（与 ImpactSite.line 同一坐标系）。 */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** 一侧的改动面：文件集 + 可选的行区间（有 hunk 就按行求交，没有就整文件全量）。 */
export interface WorkerTouch {
  readonly agentId: string;
  readonly files: readonly string[];
  readonly hunks?: ReadonlyMap<string, readonly LineRange[]>;
}

export type ConflictKind = "same-symbol" | "cross-consumer";

export interface SymbolConflict {
  readonly kind: ConflictKind;
  readonly symbol: string;
  readonly mine: { readonly agentId: string; readonly file: string; readonly line: number };
  readonly theirs: { readonly agentId: string; readonly file: string; readonly line: number };
}

/** 每一对 worker 最多列这么多条（合并卡/回执是给人看的；与 lease-conflicts ④ 同档）。 */
export const RADAR_PAIR_LIMIT = 6;

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u;

/** 解析 unified diff 的新文件侧行区间（`git diff -U0` 同形；带上下文的 diff 也吃得下）。
 *  返回 workspace 相对路径 → 1-based 闭区间清单；删除（`+++ /dev/null`）与二进制块跳过。
 *  纯删除的 hunk（`+c,0`）记成 `[c, c]`：那个位置上的符号确实被拿掉了，删也算一次触碰。 */
export function parseHunks(patch: string): Map<string, LineRange[]> {
  const out = new Map<string, LineRange[]>();
  let file: string | null = null;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const ref = raw.slice(4).trim().replace(/^"|"$/gu, "");
      const rel = ref.startsWith("b/") ? ref.slice(2) : ref === "/dev/null" ? "" : ref;
      file = rel === "" ? null : rel;
      if (file !== null && !out.has(file)) out.set(file, []);
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    if (file === null) continue;
    const m = HUNK_RE.exec(raw);
    if (m === null) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    const range: LineRange = { start, end: count > 0 ? start + count - 1 : start };
    const list = out.get(file);
    if (list === undefined) out.set(file, [range]);
    else list.push(range);
  }
  return out;
}

function inRanges(ranges: readonly LineRange[] | undefined, line: number): boolean {
  if (ranges === undefined) return true; // 没 hunk ⇒ 整文件（宁多勿漏口径）
  return ranges.some((r) => line >= r.start && line <= r.end);
}

/** 这一侧触碰到的定义符号（symbol → 该侧的一条代表站点；站点按文件/行确定性取第一条）。 */
export function symbolsTouched(graph: ImpactGraph, touch: WorkerTouch): Map<string, ImpactSite> {
  const files = new Set(touch.files);
  const out = new Map<string, ImpactSite>();
  for (const [symbol, sites] of [...graph.defs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const hit = sites
      .filter((s) => files.has(s.file) && inRanges(touch.hunks?.get(s.file), s.line))
      .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))[0];
    if (hit !== undefined) out.set(symbol, hit);
  }
  return out;
}

/** 供判卷/调用方用：某文件（可选按行区间）里有哪些定义符号。ranges 缺省 = 整文件。 */
export function symbolsAtLines(graph: ImpactGraph, file: string, ranges?: readonly LineRange[]): string[] {
  const out: string[] = [];
  for (const [symbol, sites] of graph.defs) {
    if (sites.some((s) => s.file === file && inRanges(ranges, s.line))) out.push(symbol);
  }
  return [...new Set(out)].sort();
}

function compareConflicts(a: SymbolConflict, b: SymbolConflict): number {
  const rank = (c: SymbolConflict): number => (c.kind === "same-symbol" ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
  if (a.theirs.agentId !== b.theirs.agentId) return a.theirs.agentId < b.theirs.agentId ? -1 : 1;
  return a.theirs.line - b.theirs.line;
}

/** 两两判定：same-symbol（两侧都改到同一个符号的 def）/ cross-consumer（我方改的 def 被对方改动面里的文件消费）。
 *  确定性排序（same-symbol 在前、按符号名与对方 agent 排），每对 ≤ RADAR_PAIR_LIMIT 条。 */
export function radarConflicts(
  graph: ImpactGraph,
  mine: WorkerTouch,
  others: readonly WorkerTouch[],
): SymbolConflict[] {
  if (mine.files.length === 0) return [];
  const mineDefs = symbolsTouched(graph, mine);
  if (mineDefs.size === 0) return [];
  const all: SymbolConflict[] = [];
  for (const other of others) {
    if (other.agentId === mine.agentId || other.files.length === 0) continue;
    const theirFiles = new Set(other.files);
    const theirsDefs = symbolsTouched(graph, other);
    const pair: SymbolConflict[] = [];
    for (const [symbol, site] of mineDefs) {
      const theirSite = theirsDefs.get(symbol);
      if (theirSite !== undefined) {
        pair.push({
          kind: "same-symbol",
          symbol,
          mine: { agentId: mine.agentId, file: site.file, line: site.line },
          theirs: { agentId: other.agentId, file: theirSite.file, line: theirSite.line },
        });
        continue;
      }
      const consumer: ImpactSite | undefined = upward(graph, symbol).find((r) => theirFiles.has(r.file));
      if (consumer !== undefined) {
        pair.push({
          kind: "cross-consumer",
          symbol,
          mine: { agentId: mine.agentId, file: site.file, line: site.line },
          theirs: { agentId: other.agentId, file: consumer.file, line: consumer.line },
        });
      }
    }
    pair.sort(compareConflicts);
    all.push(...pair.slice(0, RADAR_PAIR_LIMIT));
  }
  const seen = new Set<string>();
  const deduped: SymbolConflict[] = [];
  for (const c of all.sort(compareConflicts)) {
    const key = [c.kind, c.symbol, c.mine.file, String(c.mine.line), c.theirs.agentId, c.theirs.file, String(c.theirs.line)].join("\u241F");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  return deduped;
}

/** 合并闸判决（形状照 `security/merge-gate.ts` 的 mergeGateVerdict）：v1 只有 same-symbol 会拦，force 可过。 */
export function radarGateVerdict(
  conflicts: readonly SymbolConflict[],
  opts: { readonly force?: boolean } = {},
): { readonly allow: boolean; readonly blocking: SymbolConflict[] } {
  const blocking = conflicts.filter((c) => c.kind === "same-symbol");
  return { allow: blocking.length === 0 || opts.force === true, blocking };
}

/** 人类可读归因（一行一条；调用方加 `[radar] ` 前缀）：带方向、带符号、带行号。 */
export function radarNote(conflicts: readonly SymbolConflict[], limit: number = RADAR_PAIR_LIMIT): string {
  return conflicts
    .slice(0, limit)
    .map((c) => {
      const mine = `${c.mine.agentId} 改 \`${c.symbol}\`（${c.mine.file}:${String(c.mine.line)}）`;
      return c.kind === "same-symbol"
        ? `${mine}；${c.theirs.agentId} 也在改它（${c.theirs.file}:${String(c.theirs.line)}）`
        : `${mine}；${c.theirs.agentId} 的 ${c.theirs.file}:${String(c.theirs.line)} 消费它`;
    })
    .join("\n");
}
