// 量尺（一次性测量，可复跑）：影响面默认帽 400 到底让**多少次答案不一样**。
//
// 为什么要把它做成脚本而不是文档里的一句话：#32（默认帽要不要抬）是一条裁决，
// 而裁决要的是一个数。此前手上只有**覆盖面**的数（本仓 451 个候选只收 400 ⇒ 11.3% 在图外），
// 覆盖面 ≠ 准确度：漏掉的文件里可能压根没有调用方，也可能每个都是热符号的调用者。
// 这条尺量的是后者——同一个查询，缺省帽给的答案与全量图给的答案**差多少**。
//
// 两个方向的读法（所以两个数都要报）：
//  ⑴ 分歧查询数 / 可比较查询数 ⇒ "抬帽能让多少条答案变准"；
//  ⑵ 合计漏掉的跨文件调用点与波及文件 ⇒ "这些错有多错"（一条漏 = 一次改漏调用方 = 一次返工）。
// 判绿条件不是"零分歧"，是**把分歧报出来**；零分歧本身就是裁"不值得动"的依据。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildImpact, upward, IMPACT_MAX_FILES_CEILING, type ImpactGraph } from "../src/agent/impact/index.js";
import { scanSourceFilesAll } from "../src/agent/map/build.js";
import { MAX_FILES_DEFAULT } from "../src/agent/map/cap.js";

export interface AnswerPair {
  file: string;
  /** 缺省帽那张图给出的波及文件集合（已按文件去重）。 */
  capped: string[];
  /** 全量图给出的同一集合。 */
  full: string[];
  /**
   * **确证**漏报的那部分（可选）：只数「符号全仓唯一、且定义就在被查文件里」的调用点。
   * 为什么单列：分歧率是**上界**——本仓符号图是启发式的，同名符号跨文件合并，于是「全量图多报的
   * 调用方」里有一部分是撞名而不是真波及。裁「抬帽值不值」要看下界，所以两个数一起报。
   */
  confirmedExtra?: string[];
}

export interface DivergenceTally {
  /** 两张图里都在、因此**可比较**的查询数。 */
  comparable: number;
  /** 答案不同的查询数（full 比 capped 多至少一个波及文件）。 */
  divergent: number;
  /** 合计漏掉的波及文件数（每个查询各自去重后相加）。 */
  missedFiles: number;
  /** 只按「确证」那一半算：至少一处确证漏报的查询数，与确证漏报合计。 */
  confirmedQueries: number;
  confirmedSites: number;
  /** 漏掉最多的那一条：file + 它漏掉的波及文件（最多列 8 个）。 */
  worst: { file: string; extra: string[] } | null;
}

/** 两图答案的差集统计（纯函数，不做 IO；判卷在 `tests/measure-impact-cap-divergence.test.ts`）。 */
export function tallyDivergence(pairs: readonly AnswerPair[]): DivergenceTally {
  let divergent = 0;
  let missedFiles = 0;
  let confirmedQueries = 0;
  let confirmedSites = 0;
  let worst: { file: string; extra: string[] } | null = null;
  for (const p of pairs) {
    const have = new Set(p.capped);
    const extra = [...new Set(p.full)].filter((f) => !have.has(f)).sort();
    const confirmed = [...new Set(p.confirmedExtra ?? [])].sort();
    if (confirmed.length > 0) {
      confirmedQueries++;
      confirmedSites += confirmed.length;
    }
    if (extra.length === 0) continue;
    divergent++;
    missedFiles += extra.length;
    if (worst === null || extra.length > worst.extra.length) worst = { file: p.file, extra };
  }
  return { comparable: pairs.length, divergent, missedFiles, confirmedQueries, confirmedSites, worst };
}

/** 确证漏报：全仓**唯一**定义在被查文件里的符号，其跨文件调用点落在缺省帽没扫的那批文件里。
 *  唯一性是关键——同名符号（`test`、`assert`）会被启发式图跨文件合并，那种"多报"不是真波及。 */
export function confirmedExtraOf(capped: ImpactGraph, full: ImpactGraph, file: string): string[] {
  const inCapped = new Set(capped.files);
  const out = new Set<string>();
  for (const sym of [...full.defs.keys()].filter((s) => (full.defs.get(s) ?? []).some((d) => d.file === file))) {
    const defs = full.defs.get(sym) ?? [];
    if (defs.length !== 1) continue; // 非唯一 ⇒ 不算确证
    for (const site of upward(full, sym)) if (!inCapped.has(site.file)) out.add(site.file);
  }
  return [...out];
}

/** 一张图里"改这个文件会波及谁"的答案（与 `fileImpact` 同一套取料：本文件定义的符号 → upward）。 */
function answerOf(graph: ImpactGraph, file: string): string[] {
  const syms = [...graph.defs.keys()].filter((s) => (graph.defs.get(s) ?? []).some((d) => d.file === file));
  const out = new Set<string>();
  for (const s of syms) for (const site of upward(graph, s)) out.add(site.file);
  return [...out].sort();
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 建一张图（独立冷缓存）并返回耗时。 */
async function buildCold(workspace: string, maxFiles: number, tag: string): Promise<{ graph: ImpactGraph; ms: number }> {
  const cache = await mkdtemp(join(tmpdir(), `impact-cap-${tag}-`));
  try {
    const t0 = Date.now();
    const graph = await buildImpact({ workspace, cacheDir: cache, maxFiles });
    return { graph, ms: Date.now() - t0 };
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

// 单跑一种帽：`--only=cap` / `--only=full`。为什么要这个口子——建图耗时在一进程里**测不准**：
// 四次数落在 840~1981ms，顺序与语法预热带来的散布比两种帽的差本身还大 ⇒
// 拿它写"抬帽只贵 Nms"就是把噪声当结论。真代价要在**独立进程**里各跑数次取中位。
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);

async function main(): Promise<void> {
  if (onlyArg === "cap" || onlyArg === "full") {
    const cap = onlyArg === "cap" ? MAX_FILES_DEFAULT : IMPACT_MAX_FILES_CEILING;
    const { graph, ms } = await buildCold(ROOT, cap, `one-${onlyArg}`);
    console.log(`only=${onlyArg} cap=${String(cap)} files=${String(graph.files.length)} ms=${String(ms)}`);
    return;
  }
  const candidates = await scanSourceFilesAll(ROOT);
  // 代价必须**同位**比：同一进程里连着建两张图，第二张永远更快（tree-sitter grammar 与
  // V8 预热都是一次性的），于是"全量比缺省帽便宜 855ms"这种荒数就会出现——那量的是顺序，不是帽。
  // ⇒ 两种帽各跑一次"先建"与一次"后建"，报四个数，只用**同位**的那一对下结论。
  const [a1, a2] = [
    await buildCold(ROOT, MAX_FILES_DEFAULT, "cap-first"),
    await buildCold(ROOT, IMPACT_MAX_FILES_CEILING, "full-second"),
  ];
  const [b1, b2] = [
    await buildCold(ROOT, IMPACT_MAX_FILES_CEILING, "full-first"),
    await buildCold(ROOT, MAX_FILES_DEFAULT, "cap-second"),
  ];
  const capped = a1.graph;
  const full = b1.graph;
  const pairs: AnswerPair[] = capped.files.map((f) => ({
    file: f, capped: answerOf(capped, f), full: answerOf(full, f), confirmedExtra: confirmedExtraOf(capped, full, f),
  }));
  const t = tallyDivergence(pairs);
  const inCapped = new Set(capped.files);
  const extraFiles = full.files.filter((f) => !inCapped.has(f));
  // 顺带一条**与帽无关**的读数：全量图里有多少符号本来就有好几份同名定义（第 60 页那条"并集自述"
  // 多久发射一次由此决定）。放在这里是因为两张图都已经建好，加这一条不再花任何解析。
  const multiDef = [...full.defs.values()].filter((ds) => new Set(ds.map((d) => d.file)).size > 1).length;
  // 自证：漏掉的波及文件**必须全部**来自帽外那批（否则两图之间还有帽以外的差别，这条尺就量错东西了）。
  const missed = new Set(pairs.flatMap((p) => p.full.filter((f) => !p.capped.includes(f))));
  const allFromExcluded = [...missed].every((f) => !inCapped.has(f));
  console.log(`候选源码=${String(candidates.length)} 缺省帽=${String(MAX_FILES_DEFAULT)} 收录=${String(capped.files.length)} 全量图收录=${String(full.files.length)}`);
  console.log(
    `一进程内建图（**不作代价结论**，散布压过差值）：缺省帽 先=${String(a1.ms)}ms 后=${String(b2.ms)}ms ｜ ` +
    `全量 先=${String(b1.ms)}ms 后=${String(a2.ms)}ms ⇒ 要代价数请跑 --only=cap / --only=full 各数次（独立进程）`,
  );
  console.log(`帽外文件=${String(extraFiles.length)}（这些文件在缺省帽下**根本问不出答案**，只能得到"图外 ⇒ 未知"）：${extraFiles.slice(0, 6).join(", ")} …`);
  console.log(`同名多份定义的符号=${String(multiDef)} / 图内符号共 ${String(full.defs.size)} ⇒ 并集自述会在这这么多查询上发射（与帽无关，是图本身的性质）`);
  console.log(
    `可比较查询=${String(t.comparable)} 其中答案不同=${String(t.divergent)}` +
    `（${t.comparable > 0 ? ((t.divergent / t.comparable) * 100).toFixed(1) : "n/a"}%）` +
    ` 合计漏掉的波及文件=${String(t.missedFiles)}（去重后 ${String(missed.size)} 个文件）`,
  );
  console.log(`口径自检：漏掉的波及文件是否全部来自帽外那批 = ${allFromExcluded ? "是（尺量对了东西）" : "**否——两图间还有帽以外的差别，本读数作废**"}`);
  console.log(
    `上界 vs 下界：分歧查询 ${String(t.divergent)} 条里有 ${String(t.confirmedQueries)} 条含**确证**漏报` +
    `（确证波及文件合计 ${String(t.confirmedSites)}）⇒ 确证口径下的查询分歧率 ` +
    `${t.comparable > 0 ? ((t.confirmedQueries / t.comparable) * 100).toFixed(1) : "n/a"}%`,
  );
  if (t.worst !== null) console.log(`漏得最多：${t.worst.file} ⇒ 缺省帽答不出 ${String(t.worst.extra.length)} 个波及文件：${t.worst.extra.slice(0, 8).join(", ")}`);
  else console.log("零分歧：缺省帽没有让任何一条答案变错 ⇒ #32 可按「不值得为它改默认」裁（复跑本脚本即可反证）。");
  if (!allFromExcluded) process.exitCode = 1;
}

// 只在直接执行时跑测量：本文件导出纯函数给判卷 import，模块加载不得有副作用
// （一次 import 就去建两张图 = 秒级 CPU + 临时目录，还会污染整张测试表）。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) void main();
