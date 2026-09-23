// 复跑面 · 登记项 `replay:latency`（判卷读数：工具耗时分布，以及「一轮里到底发几个工具调用」）
//
// 为什么立这条：`createEventLog.append` 之前不给任何事件盖时间戳——真语料 282 条 tool_call
// 一条 `ts` 都没有（2026-09-23 实测）。于是三件事全都只能靠外部脚本掐表：
//  ⑴ orchestration spec §5 **D8**（并发执行只读工具）的 go/no-go —— 它要的是「一轮里有几个调用」；
//  ⑵ 看门狗 / `waitAll` 超时 / panels-check 那类**时序 flake** 的归因（红在哪一段根本看不出来）；
//  ⑶ 评测的**成本轴**（同样做对，墙钟差多少）。
// 现在戳有了，这条面就是它的第一个消费者。
//
// 三条口径纪律：
//  ⑴ **一个文件 = 一条流，逐条算完再合并**。把多个会话拼成一条数组会撞 `tool_call.id`
//     （不同会话里 `c1` 遍地都是），配对与"轮"都会错位——本面第一版就因此报出过一个假的
//     「19 轮 / 最多 25 个调用」。合并只走 `tallyStreams`，那里头没有任何跨流的轮概念。
//  ⑵ **两半可测时点不同**：触发面（一轮几个调用）不需要戳；时间面需要。没戳 ⇒ 红着退出说
//     「不可测」，绝不报「工具耗时 0ms」——「读到 0」与「没有尺」必须长成两个样子。
//  ⑶ 孤儿 result / 有调用无结果，各自记账，不混进时长也不静默丢。
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";

/** spec §5 D8 点名的「并发安全只读工具」。这是**读数面**的分类，不是执行面的策略：
 *  D8 真要落地时，白名单归 `runLoop` 自己声明并配判据（本面只回答"值不值得做"）。 */
export const D8_SAFE_TOOLS: ReadonlySet<string> = new Set(["read_file", "grep", "glob", "lsp", "impact_query"]);

export interface ToolLatency {
  n: number;
  totalMs: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
}

export interface LatencyTally {
  /** 既配对了、又两端有戳的调用数（时间面的分母）。 */
  paird: number;
  /** 配对成功但缺戳的对数——用来把「没尺」与「尺读不到」分开。 */
  pairsWithoutTs: number;
  /** 有 result 却没有 call 的孤儿（不静默跳过）。 */
  orphanResults: number;
  /** 有 call 却没有 result。**至少三种成因，本面不区分**（要区分就得读工具表）：
   *  ① 收束时在飞/被中断；② `verify` 是系统门，按设计落 `verify_result` 而不落配对的
   *  `tool_result`（真语料里那 1 条就是这个，不是缺陷）；③ 真的漏了一条。
   *  所以这个数只能当"待归因的分母"，不许直接读成"丢了 N 次结果"。 */
  openCalls: number;
  toolTimeMs: number;
  /** 流内戳的跨度（min→max）；无戳为 0。 */
  spanMs: number;
  /** 至少一个 tool_call 带数字 ts。 */
  hasTimestamps: boolean;
  /** 按工具名留原始样本（合并两条流时百分位必须由样本重算，不能拿两个 p50 平均）。 */
  samplesMs: Map<string, number[]>;
  byTool: Map<string, ToolLatency>;
  /** 含至少一次工具调用的轮数（触发面的分母）。 */
  turnsWithCalls: number;
  /** 其中一轮 ≥2 个调用的轮数（D8 的触发面）。 */
  multiCallTurns: number;
  /** D8 能折进同一拍的调用数：逐轮累加 `max(0, 该轮只读调用数 − 1)`。
   *  为什么不用「整轮全只读」当判据：真语料里有一轮发了 25 个调用（23 个 read_file + spawn_agent 等），
   *  按"全只读"它整轮被判不可并发 ⇒ 把 D8 最大的那个触发面读成 0（第一版就是这么错的）。
   *  spec §5 D8 说的是"白名单并发、写类串行"，所以能并发的就是那一子集。 */
  d8SavableCalls: number;
  maxCallsPerTurn: number;
}

/** 最近秩百分位（n 小，别造第二把尺：这里要的只是"典型 / 尾巴"两个数）。 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

function toolStats(samples: Map<string, number[]>): Map<string, ToolLatency> {
  const out = new Map<string, ToolLatency>();
  for (const [name, list] of samples) {
    const sorted = [...list].sort((a, b) => a - b);
    out.set(name, {
      n: sorted.length,
      totalMs: sorted.reduce((a, b) => a + b, 0),
      p50Ms: percentile(sorted, 50),
      p90Ms: percentile(sorted, 90),
      maxMs: sorted[sorted.length - 1] ?? 0,
    });
  }
  return out;
}

const emptyTally = (): LatencyTally => ({
  paird: 0, pairsWithoutTs: 0, orphanResults: 0, openCalls: 0,
  toolTimeMs: 0, spanMs: 0, hasTimestamps: false,
  samplesMs: new Map<string, number[]>(), byTool: new Map<string, ToolLatency>(),
  turnsWithCalls: 0, multiCallTurns: 0, d8SavableCalls: 0, maxCallsPerTurn: 0,
});

/** 纯函数：**吃一条流**（一个会话文件的事件），吐这条流的读数。跨流合并请用 `foldLatency`。 */
export function tallyLatency(raws: readonly unknown[]): LatencyTally {
  const t = emptyTally();
  const calls = new Map<string, { name: string; ts?: number }>();
  // 轮 = 「pending 从非空回到空」那一段：一调一果交替 ⇒ 每轮 1 个调用；
  // 连续两个 call 再两个 result ⇒ 一轮 2 个调用。
  let pending = 0;
  let turnCalls = 0;
  let turnNames: string[] = [];
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const raw of raws) {
    const e = raw as { type?: string; id?: string; callId?: string; name?: string; ts?: unknown };
    if (typeof e.ts === "number" && Number.isFinite(e.ts)) {
      if (e.ts < minTs) minTs = e.ts;
      if (e.ts > maxTs) maxTs = e.ts;
    }
    if (e.type === "tool_call" && typeof e.id === "string") {
      const name = String(e.name ?? "");
      const ts = typeof e.ts === "number" ? e.ts : undefined;
      calls.set(e.id, { name, ts });
      if (ts !== undefined) t.hasTimestamps = true;
      pending++;
      turnCalls++;
      turnNames.push(name);
      continue;
    }
    if (e.type !== "tool_result" || typeof e.callId !== "string") continue;
    const c = calls.get(e.callId);
    if (c === undefined) {
      t.orphanResults++;
      continue;
    }
    calls.delete(e.callId);
    pending--;
    const resTs = typeof e.ts === "number" ? e.ts : undefined;
    if (c.ts === undefined || resTs === undefined) {
      t.pairsWithoutTs++;
    } else {
      const ms = Math.max(0, resTs - c.ts);
      t.paird++;
      t.toolTimeMs += ms;
      const seen = t.samplesMs.get(c.name);
      if (seen === undefined) t.samplesMs.set(c.name, [ms]);
      else seen.push(ms);
    }
    if (pending === 0 && turnCalls > 0) {
      t.turnsWithCalls++;
      if (turnCalls >= 2) t.multiCallTurns++;
      const safe = turnNames.reduce((n, x) => n + (D8_SAFE_TOOLS.has(x) ? 1 : 0), 0);
      t.d8SavableCalls += Math.max(0, safe - 1);
      if (turnCalls > t.maxCallsPerTurn) t.maxCallsPerTurn = turnCalls;
      turnCalls = 0;
      turnNames = [];
    }
  }
  t.openCalls = calls.size; // 剩下的都是有 call 没 result 的（被中断 / 收束时在飞）
  if (Number.isFinite(minTs) && Number.isFinite(maxTs)) t.spanMs = Math.max(0, maxTs - minTs);
  t.byTool = toolStats(t.samplesMs);
  return t;
}

/** 多流合并：计数相加，百分位**从样本重算**（两个 p50 平均出来的不是 p50）。
 *  `spanMs` 取各流之和而不是首末差——跨会话拼出来的"总时长"没有意义。 */
function foldLatency(parts: readonly LatencyTally[]): LatencyTally {
  const t = emptyTally();
  for (const p of parts) {
    t.paird += p.paird;
    t.pairsWithoutTs += p.pairsWithoutTs;
    t.orphanResults += p.orphanResults;
    t.openCalls += p.openCalls;
    t.toolTimeMs += p.toolTimeMs;
    t.spanMs += p.spanMs;
    t.hasTimestamps ||= p.hasTimestamps;
    t.turnsWithCalls += p.turnsWithCalls;
    t.multiCallTurns += p.multiCallTurns;
    t.d8SavableCalls += p.d8SavableCalls;
    if (p.maxCallsPerTurn > t.maxCallsPerTurn) t.maxCallsPerTurn = p.maxCallsPerTurn;
    for (const [name, list] of p.samplesMs) {
      const seen = t.samplesMs.get(name);
      if (seen === undefined) t.samplesMs.set(name, [...list]);
      else seen.push(...list);
    }
  }
  t.byTool = toolStats(t.samplesMs);
  return t;
}

/** 一个文件 = 一条流：逐条 `tallyLatency` 后再合并。
 *  这条形状是**判据对象**而不是实现细节：把多条流拼成一条数组去 tally，会让一条流末尾未闭合的调用
 *  把下一条流的"轮"吞掉（pending 永不归零），实测把 189 轮读成 19 轮。`tallyStreams` 与
 *  `tallyLatency(拼起来的一串)` 的差就是这条纪律，两侧都有用例钉。 */
export function tallyStreams(streams: readonly (readonly unknown[])[]): LatencyTally {
  return foldLatency(streams.map((raws) => tallyLatency(raws)));
}

export interface SourcePick {
  files: string[];
  /** 非 null = 取料本身不成立，调用方必须红着退出。 */
  problem: string | null;
}

/** 取料：不给参数用登记表语料；给了路径就**只用**那些路径。
 *  任一路径下一条 `.jsonl` 也没有 ⇒ 整条读数不作（清空 files 并点名该路径）。
 *  "退回全语料"是这里最省事的写法，也正是最坏的：打错一个目录名会读出一批
 *  看起来像本次的数（本仓「假读数长得像真读数」那一族的入口）。 */
export function pickSources(
  args: readonly string[],
  corpus: readonly string[],
  listJsonl: (p: string) => string[],
): SourcePick {
  if (args.length === 0) return { files: [...corpus], problem: null };
  const files: string[] = [];
  const empty: string[] = [];
  for (const a of args) {
    const found = listJsonl(a);
    if (found.length === 0) empty.push(a);
    else files.push(...found);
  }
  if (empty.length > 0) {
    return {
      files: [],
      problem: "指定路径里没有 .jsonl：" + empty.join(", ") +
        " ⇒ 整条读数不作（不退回收全语料——那会把打错路径读成「本次有数据」）",
    };
  }
  return { files: [...new Set(files)], problem: null };
}

/** 纯函数版结论：时间面能不能读、触发面有没有面，各自说清。 */
export function latencyVerdict(t: LatencyTally): { exitCode: 0 | 1; lines: string[] } {
  const lines = [
    "触发面：轮=" + String(t.turnsWithCalls) + " · 一轮≥2 个调用=" + String(t.multiCallTurns) +
      "（单轮最多 " + String(t.maxCallsPerTurn) + " 个）· 只读调用可折进同一拍=" + String(t.d8SavableCalls) + " 次",
  ];
  if (t.turnsWithCalls === 0) {
    lines.unshift("本面**不可测**：语料里一条 tool_call 也没有（没有调用就没有延迟，也没有触发面）。");
    return { exitCode: 1, lines };
  }
  if (!t.hasTimestamps) {
    lines.push(
      "时间面**不可测**：这批语料无戳（早于 append 盖 `ts`）。配对成功但读不到时间的对数=" +
        String(t.pairsWithoutTs) + " ⇒ 换到有戳的会话流上再跑，别把它读成「工具耗时 0ms」。",
    );
    return { exitCode: 1, lines };
  }
  const share = t.spanMs > 0 ? Math.round((t.toolTimeMs / t.spanMs) * 100) : 0;
  lines.push(
    "时间面：可计时调用=" + String(t.paird) + " · 缺戳对=" + String(t.pairsWithoutTs) +
      " · 有调用无结果=" + String(t.openCalls) + " · 孤儿 result=" + String(t.orphanResults),
  );
  lines.push("工具占总耗时 " + String(share) + "%（工具 " + String(t.toolTimeMs) + "ms / 跨度 " + String(t.spanMs) + "ms）");
  for (const [name, s] of [...t.byTool.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 8)) {
    lines.push(
      "  " + name + " · n=" + String(s.n) + " p50=" + String(s.p50Ms) + "ms p90=" + String(s.p90Ms) +
        "ms max=" + String(s.maxMs) + "ms 合计=" + String(s.totalMs) + "ms",
    );
  }
  lines.push(
    t.d8SavableCalls === 0
      ? "⇒ D8（并发只读工具）在这些轨迹上**没有触发面**：没有一轮出现过两个可并发的只读调用，实现了也并发不了。"
      : "⇒ D8 的触发面 =" + String(t.multiCallTurns) + " 个多调用轮、可折掉 " + String(t.d8SavableCalls) +
        " 次串行等待；真正的收益要看这些调用各花多少时间（下一行），全是几毫秒的本地读就没有。",
  );
  return { exitCode: 0, lines };
}

function main(): void {
  const scan = scanCorpus();
  // 允许 `node --import tsx scripts/replay/latency.ts <路径>…`：路径可以是会话目录，也可以是单个 .jsonl。
  // 时间面要有戳才能读，所以这条用于刚跑完的 `.tmp/e2e-log.jsonl` 与新会话目录。
  const pick = pickSources(process.argv.slice(2), scan.files, (p) => {
    try {
      const st = statSync(p);
      if (st.isDirectory()) return scanCorpus([p], 4).files;
      return p.endsWith(".jsonl") ? [p] : [];
    } catch {
      return [];
    }
  });
  if (pick.problem !== null) {
    console.error("⚠️ latency 取料失败：" + pick.problem);
    process.exitCode = 1;
    return;
  }
  const empty = zeroCorpusProblem({ files: pick.files, missingRoots: scan.missingRoots });
  if (empty !== null) {
    console.error("⚠️ latency 读数无意义：" + empty);
    process.exitCode = 1;
    return;
  }
  const v = latencyVerdict(tallyStreams(pick.files.map((f) => readJsonl(f))));
  for (const l of v.lines) console.log(l);
  console.log("（语料：" + String(pick.files.length) + " 个 .jsonl，逐条成流后合并" +
    (process.argv.slice(2).length > 0 ? "，取料 = 命令行指定路径" : "") + "）");
  process.exitCode = v.exitCode;
}

// 只在直接执行时跑读数：判卷要 import 纯函数，模块加载不得有副作用（也不该扫盘）。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
