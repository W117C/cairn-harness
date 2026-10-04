// P0 装配账读数（只读尺子）。
//
// 用法：
//   node --import tsx scripts/observe-surface.ts <会话.jsonl> [更多会话…] [--factor 3.6] [--json]
//   （或 `pnpm observe-surface <会话.jsonl>`）
//
// 回答 P0 的四个问题：
//   ㈠ 真实固定面多少字符——`declared` / `sent` **两个基分开报**（混读会把送出面读成声明面，
//      而 24k 帽下送出面恒 ≤ 约 6.7k token，结论会直接读反）
//   ㈡ 有没有触发降配梯（`overChars > 0` 的轮数）
//   ㈢ 省了谁（被压描述 / 被整条丢弃的工具名）
//   ㈣ 有没有走到 `unresolvable`（降配梯走完仍超帽，core 不被自动砍）
//
// 退出码：**量出来什么都是 0**（与 `scripts/prompt-cost.ts` 同一条理由——「红了要拦谁」还没想清楚）；
// 用法错误或文件读不开是 2。它的输出**不是判据**，不要接进 GATES。
//
// 为什么住在 `scripts/` 顶层而不是 `scripts/replay/`：那一层住的是**登记在案的判卷读数**
// （`REPLAY_READINGS`，要求同提交里有文档写 `replay:<id>` 引用它）。本件与 `prompt-cost` /
// `tool-choice` 同性质——手动跑、指哪读哪的**尺子**，没有一篇 docs/ 页承载它，所以不登记。
// 2026-10-03 实测：一开始放在 `scripts/replay/` 下，被 D-8 第五判据（未登记且无人 import = 孤儿）
// 当场判红——那条判据是对的，错的是位置。
//
// 口径提醒：`surface_account` 只有**字符**，没有 token。本仓现有两个不等的折算系数
// （`scripts/prompt-cost.ts` 用 3.6、`src/agent/memory/inject.ts` 用 4），所以 token 一律由
// `--factor` 现给，本脚本**不自带第三个数**。
//
// 无读数时**显式出声**（旧日志 / 零工具面 / 该装配路径不产生装配账），绝不静默空输出——
// 「没读到」与「面是 0」是两件事。
import { replay, type AgentEvent } from "../src/events";

type SurfaceAccount = Extract<AgentEvent, { type: "surface_account" }>;

const USAGE = [
  "用法：node --import tsx scripts/observe-surface.ts <会话.jsonl> [更多会话…] [--factor 3.6] [--json]",
  "",
  "读的是 P0 装配账事件（surface_account）。若某会话零读数，会显式打印一行说明，不静默跳过。",
].join("\n");

interface Args {
  paths: string[];
  factor: number;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const paths: string[] = [];
  let factor = 3.6;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") { json = true; continue; }
    if (a === "--factor") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error("--factor 需要一个正数，收到 " + JSON.stringify(argv[i]));
      factor = v;
      continue;
    }
    if (a.startsWith("--")) throw new Error("未知参数：" + a);
    paths.push(a);
  }
  return { paths, factor, json };
}

const accountsOf = (events: readonly AgentEvent[]): SurfaceAccount[] =>
  events.filter((e): e is SurfaceAccount => e.type === "surface_account");

const estTokens = (chars: number, factor: number): number => Math.round(chars / factor);

interface SessionReading {
  path: string;
  turns: number;
  degradedTurns: number;
  unresolvableTurns: number;
  faceChangedTurns: number;
  maxDeclaredChars: number;
  maxSentChars: number;
  /** 易变侧四块的最大值与均值——降配梯口径（system+工具）之外的那一半。 */
  maxVolatileChars: number;
  maxVolatileParts: { memory: number; skills: number; map: number; attachment: number };
  /** 旧日志没有 volatileChars（字段是后加的）：缺席必须与「真的是 0」分得开。 */
  volatileKnownTurns: number;
  shortened: Map<string, number>;
  dropped: Map<string, number>;
  rows: SurfaceAccount[];
}

async function readSession(path: string): Promise<SessionReading | { path: string; error: string }> {
  let events: AgentEvent[];
  try {
    events = await replay(path);
  } catch (error) {
    return { path, error: error instanceof Error ? error.message : String(error) };
  }
  const rows = accountsOf(events);
  const shortened = new Map<string, number>();
  const dropped = new Map<string, number>();
  for (const r of rows) {
    for (const n of r.shortened) shortened.set(n, (shortened.get(n) ?? 0) + 1);
    for (const n of r.dropped) dropped.set(n, (dropped.get(n) ?? 0) + 1);
  }
  return {
    path,
    turns: rows.length,
    degradedTurns: rows.filter((r) => r.overChars > 0).length,
    unresolvableTurns: rows.filter((r) => r.unresolvable).length,
    faceChangedTurns: rows.filter((r) => r.faceChanged).length,
    maxDeclaredChars: rows.reduce((m, r) => Math.max(m, r.declaredToolSpecChars), 0),
    maxSentChars: rows.reduce((m, r) => Math.max(m, r.sentToolSpecChars), 0),
    maxVolatileChars: rows.reduce((m, r) => Math.max(m, volatileOf(r)), 0),
    maxVolatileParts: {
      memory: rows.reduce((m, r) => Math.max(m, partOf(r, "memoryChars")), 0),
      skills: rows.reduce((m, r) => Math.max(m, partOf(r, "skillsBlockChars")), 0),
      map: rows.reduce((m, r) => Math.max(m, partOf(r, "mapChars")), 0),
      attachment: rows.reduce((m, r) => Math.max(m, partOf(r, "attachmentContextChars")), 0),
    },
    volatileKnownTurns: rows.filter((r) => typeof r.volatileChars === "number").length,
    shortened,
    dropped,
    rows,
  };
}

/** 易变侧合计。**旧日志没有这个字段**：缺席读作 0，但 `volatileKnownTurns` 会同时报出
 *  「有几轮确实记了」⇒ 「没记」与「真是 0」在输出上分得开（与 P0 事件空数组同一条纪律）。 */
const volatileOf = (a: SurfaceAccount): number =>
  typeof a.volatileChars === "number" ? a.volatileChars : 0;
const partOf = (a: SurfaceAccount, key: "memoryChars" | "skillsBlockChars" | "mapChars" | "attachmentContextChars"): number =>
  typeof a[key] === "number" ? a[key] : 0;

const topNames = (m: Map<string, number>): string =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n, c]) => `${n}×${String(c)}`).join(", ");

/** 表内几个名字里挑一个短标签，供终端对齐用。 */
const short = (p: string): string => (p.length <= 46 ? p : "…" + p.slice(-45));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.paths.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }

  const readings = await Promise.all(args.paths.map(readSession));
  const failed = readings.filter((r): r is { path: string; error: string } => "error" in r);

  if (args.json) {
    console.log(JSON.stringify({
      factor: args.factor,
      sessions: readings.map((r) => ("error" in r ? r : {
        path: r.path, turns: r.turns, degradedTurns: r.degradedTurns,
        unresolvableTurns: r.unresolvableTurns, faceChangedTurns: r.faceChangedTurns,
        maxDeclaredChars: r.maxDeclaredChars, maxSentChars: r.maxSentChars,
        estDeclaredTokens: estTokens(r.maxDeclaredChars, args.factor),
        estSentTokens: estTokens(r.maxSentChars, args.factor),
        maxVolatileChars: r.maxVolatileChars, maxVolatileParts: r.maxVolatileParts,
        volatileKnownTurns: r.volatileKnownTurns,
        shortened: Object.fromEntries(r.shortened), dropped: Object.fromEntries(r.dropped),
        rows: r.rows,
      })),
    }, null, 2));
    process.exit(failed.length > 0 ? 2 : 0);
  }

  console.log("== P0 装配账读数（每个会话：每轮 declared/sent 两个基）==");
  console.log("口径：字符；token 按 factor=" + String(args.factor) + " 折算（本仓另有 memory/inject 的 4，两者不等，故不自带常数）");
  console.log("");

  let anyTurns = 0;
  for (const r of readings) {
    if ("error" in r) {
      console.log("  ✗ " + short(r.path) + " —— 读不开：" + r.error);
      continue;
    }
    console.log("  " + short(r.path));
    if (r.turns === 0) {
      // 「没读到」≠「面是 0」：旧日志（本事件之前）、零工具面、或该路径根本不产生装配账。
      console.log("      （无 surface_account 读数：旧日志 / 零工具面 / 该装配路径不产生装配账）");
      console.log("");
      continue;
    }
    anyTurns += r.turns;
    console.log("      轮次  declared(件/字符)   sent(件/字符)      易变侧   超帽  面变  压描述  丢整条  unresolvable");
    for (const a of r.rows) {
      const vol = typeof a.volatileChars === "number"
        ? String(a.volatileChars)
        : "(旧日志未记)";
      console.log("      " + String(a.attemptSeq).padStart(4)
        + "  " + (String(a.declaredToolCount) + "/" + String(a.declaredToolSpecChars)).padStart(16)
        + "  " + (String(a.sentToolCount) + "/" + String(a.sentToolSpecChars)).padStart(14)
        + "  " + vol.padStart(10)
        + "  " + (a.overChars > 0 ? String(a.overChars) : "-").padStart(6)
        + "  " + (a.faceChanged ? "是" : "-").padStart(4)
        + "  " + String(a.shortened.length).padStart(6)
        + "  " + String(a.dropped.length).padStart(6)
        + "  " + (a.unresolvable ? "**是**" : "否").padStart(12));
    }
    console.log("      ── 汇总：有账 " + String(r.turns) + " 轮｜降配 " + String(r.degradedTurns)
      + " 轮｜unresolvable " + String(r.unresolvableTurns) + " 轮｜面变 " + String(r.faceChangedTurns) + " 轮");
    console.log("         最大 declared 面 " + String(r.maxDeclaredChars) + " 字符 ≈ "
      + String(estTokens(r.maxDeclaredChars, args.factor)) + " tok");
    console.log("         最大 sent 面     " + String(r.maxSentChars) + " 字符 ≈ "
      + String(estTokens(r.maxSentChars, args.factor)) + " tok（受 limitChars=24000 约束）");
    if (r.volatileKnownTurns > 0) {
      const p = r.maxVolatileParts;
      console.log("         最大易变侧合计   " + String(r.maxVolatileChars) + " 字符（记忆 " + String(p.memory)
        + " / skills 块 " + String(p.skills) + " / 地图 " + String(p.map) + " / 附件 " + String(p.attachment) + "）");
      console.log("           **降配梯看不见这一半**（model-surface 口径只有 system+工具）；这一行是它唯一的观测面。");
      console.log("           口径：压缩**前**快照，不是上界——压缩会重建 skills 块，且可能因新增重挂资格而变大。");
    } else if (r.turns > 0) {
      console.log("         （这批账都没有易变侧字段：本事件加该字段之前落的盘。）");
    }
    if (r.shortened.size > 0) console.log("         压过描述：" + topNames(r.shortened));
    if (r.dropped.size > 0) console.log("         整条丢过：" + topNames(r.dropped));
    console.log("");
  }

  console.log("== 判读 ==");
  if (anyTurns === 0) {
    console.log("  这一批会话**一条账都没有**。先确认它们跑在会过 planSurfaceBudget 的装配路径上");
    console.log("  （主会话 / gym 明卷暗卷 / probe）。worker 与 sidechat 是另外的 provider，**本来就不产生装配账**。");
  } else {
    console.log("  逐条对 P0 四问：");
    console.log("    ㈠ 面多大 —— 看上表的 declared/sent 两列，别只看一个（差 = 降配吃掉的）");
    console.log("    ㈡ 有没有降配 —— 「超帽」列非 '-' 的轮次");
    console.log("    ㈢ 省了谁 —— 各会话汇总里的「压过描述 / 整条丢过」");
    console.log("    ㈣ unresolvable —— 汇总那一行");
    console.log("    ＋ 易变侧多大 —— 各会话汇总的「最大易变侧合计」（2026-10-03 补的一格：");
    console.log("      它不在降配梯的口径里，却每轮真发出去；这一行是它唯一的观测面）");
    console.log("");
    console.log("  注意：sent 面受 24000 字符帽约束，**结构性**不可能越过 10k token（≈36000 字符）那条");
    console.log("  按需装载触发线；只有 declared 面越线才有信息量。把两者混读会误触发「含插件真实面 >10K」。");
  }

  process.exit(failed.length > 0 ? 2 : 0);
}

await main();
