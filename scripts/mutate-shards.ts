// 复跑面 · `mutate-shards`：把整张变异表切 N 份、在 N 棵**各自的**干净树里并发跑，再把判定并回一句话。
//
// 为什么不是把 mutate-verify 改成本机并行：那台机器**就地改源文件**，一个进程只能占一棵树；
// 并行的唯一安全形状是「一片一棵树＋一片一个锁标签」。所以这里不碰那台机器的内部，
// 只在外面做三件事：① 取料（名单来自它自己的 `--list` 协议，不另起一把尺）② 切分并**证分割**
// ③ 每片的判定用**已有的** triage 谓词归类，再合并（读不出不并进 0）。
//
// 实测依据（`outputs/mutation-parallel-shard-2026-09-29/measurements.md`）：4 路并发在 8 核机上给 2.38×，
// 且「会写树外面量的那一族判卷」三次并发都没偶发红——所以缺的不是许可，是合并这一步。
//
// 退出码三态：0＝每一片都判「已杀死」；1＝有片判红（存活／红了未点名／基线红／未生效）；
// 2＝**取料坏**（树不干净／两片同一路径／名单为空／红行抽取对不上）——这一档不是「没有红」，是没尺。
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorCostsFromLog, hostsSplitAcrossShards, mergeShards, packingCell, partitionProof, planShards, rollupLine, shardRow, splitShards, type ShardRow } from "./lib/shard-plan";

const MV = "scripts/mutate-verify.mjs";
const MAX_BUF = 64 * 1024 * 1024;

interface Flags {
  trees: string[];
  changedSince: string | null;
  budgetMs: number | null;
  serialSeconds: number | null;
  lockTagBase: string;
  dryRun: boolean;
  /** 切法。缺省 `host`＝按判卷宿主成组（安全）；`roundrobin` 是**给反向证人用的观察输入**：
   *  它把同一宿主摊开，好让「不许跨片」那一格有可达的输入可红——
   *  否则那条守卫只有文字钉，把 `if (split.length > 0)` 改成 `if (false)` 也照样绿（第 186 页同一课）。 */
  forceSplit: "host" | "roundrobin";
  /** 装箱权重的来源文件（机器原文）。空＝用**本标签上一轮**的片原文（读权重发生在截断之前）。 */
  costLogs: string[];
  ids: string[];
}

/** 只认这几种写法，认不出就拒（同 `mutate-verify` 那条纪律：看不懂不能退化成「按缺省办」）。
 *  `problem` 与 `unknown` 分开：「给了 `--budget-ms=abc`」不是拼错 flag，是值坏——
 *  合成一格会让读者去查一个其实存在的 flag（第 184 页那条「归因守错格」的同族）。 */
export function parseArgs(argv: readonly string[]): { flags: Flags | null; unknown: string[]; problem: string } {
  const unknown: string[] = [];
  const trees: string[] = [];
  const costLogs: string[] = [];
  const ids: string[] = [];
  let changedSince: string | null = null;
  let budgetMs: number | null = null;
  let serialSeconds: number | null = null;
  let lockTagBase = "shard";
  let dryRun = false;
  let forceSplit: Flags["forceSplit"] = "host";
  let problem = "";
  /** 两种写法都收：`--flag=值` 与 `--flag 值`。
   *  这不是"贴心"，是**同一扇门的两条缝**：被包起来的 `mutate-verify` 只认 `--budget-ms 值`（空格写法，
   *  它的读取器不解析连写），而本编排器从前只认连写 ⇒ 照机器那份手册去敲的命令，会在自己这一层被判「未知参数」。
   *  第十三族（同族出口抄两份、宽度不同）在 CLI 形状上的样子。 */
  const VALUE_FLAGS = ["--trees", "--changed-since", "--budget-ms", "--serial-seconds", "--lock-tag-base", "--force-split", "--cost-logs"] as const;
  const take = (name: string, value: string | undefined): void => {
    if (value === undefined) { problem = `${name} 后面没有值`; return; }
    if (name === "--trees") trees.push(...value.split(",").filter((s) => s !== ""));
    else if (name === "--cost-logs") costLogs.push(...value.split(",").filter((s) => s !== ""));
    else if (name === "--changed-since") changedSince = value;
    else if (name === "--budget-ms") budgetMs = Number(value);
    else if (name === "--serial-seconds") serialSeconds = Number(value);
    else if (name === "--lock-tag-base") lockTagBase = value;
    else {
      if (value !== "host" && value !== "roundrobin") problem = `--force-split 只认 host|roundrobin，收到：${value}`;
      else forceSplit = value;
    }
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--dry-run") { dryRun = true; continue; }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(0, eq) : a;
    if ((VALUE_FLAGS as readonly string[]).includes(name)) {
      if (eq > 0) take(name, a.slice(eq + 1));
      else { take(name, argv[i + 1]); i += 1; }
      continue;
    }
    if (a.startsWith("--")) { unknown.push(a); continue; }
    ids.push(a);
  }
  if (problem === "") {
    if (budgetMs !== null && !Number.isFinite(budgetMs)) problem = `--budget-ms 的值不是数：${String(budgetMs)}`;
    else if (serialSeconds !== null && !Number.isFinite(serialSeconds)) problem = `--serial-seconds 的值不是数：${String(serialSeconds)}`;
    else if (trees.length === 0) problem = "缺 --trees=树1,树2[,…]（并行至少要两棵；一棵请直接跑 mutate-verify）";
  }
  if (problem !== "" || unknown.length > 0) return { flags: null, unknown, problem };
  return {
    flags: { trees, changedSince, budgetMs, serialSeconds, lockTagBase, dryRun, forceSplit, costLogs, ids },
    unknown,
    problem,
  };
}

/** 一棵树能不能当一片用：存在、是 worktree、HEAD 取到、**工作树干净**。
 *  脏＝别人正在飞，突变会就地改它的源文件 ⇒ 拒，而不是「先跑起来再说」。
 *  导出只为让判卷能直接喂临时树（CLI 那一层造脏树太慢，而这一格判的是**理由分型**）。 */
export function treeProblem(tree: string): string {
  const abs = resolve(tree);
  if (!existsSync(abs)) return "目录不存在";
  try {
    execFileSync("git", ["-C", abs, "rev-parse", "--git-dir"], { encoding: "utf8" });
  } catch {
    return "不是 git 工作树";
  }
  const dirty = execFileSync("git", ["-C", abs, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty !== "") return `工作树有 ${String(dirty.split("\n").length)} 项在飞`;
  return "";
}

/** 名单只从机器自己那份协议取（5 列、制表符分隔）：另起一把尺就是第二份取料面，会跟表长不一致。
 *  第 4 列＝判卷文件＝**宿主**，分片要按它成组（见 `shard-plan` 里 head-cert 那一族撞窗的实测）。 */
function roster(tree: string, changedSince: string | null): { id: string; host: string }[] {
  const args = ["--import", "tsx", MV, "--list"];
  if (changedSince !== null) args.push("--changed-since=" + changedSince);
  const out = execFileSync(process.execPath, args, { cwd: resolve(tree), encoding: "utf8", maxBuffer: MAX_BUF });
  return out.split("\n")
    .filter((l) => (l.match(/\t/g) ?? []).length >= 4)
    .map((l) => {
      const cols = l.split("\t");
      return { id: (cols[0] ?? "").trim(), host: (cols[3] ?? "").trim() };
    })
    .filter((r) => r.id !== "" && r.host !== "");
}

/** 一片的原文**边跑边落盘**（不是跑完再一次性写）：整表 4 片要七八分钟，
 *  缓冲到结束才落盘意味着——① 跑的过程中读者 tail 不到任何东西；
 *  ② 外层超时/信号把编排器杀掉时，四片原文一起丢（机器自己的突变还原是它那一层的事，救不了这里的读数）。
 *  路径在**开跑之前**就印出来，同一行里给出「哪一片、多少条、写到哪」。 */
function runShard(tree: string, ids: readonly string[], tag: string, budgetMs: number | null, logPath: string): Promise<{ stdout: string; status: number | null; spawnError?: string }> {
  return new Promise((done) => {
    const args = ["--import", "tsx", MV, "--lock-tag=" + tag];
    if (budgetMs !== null) args.push("--budget-ms", String(budgetMs)); // **空格写法**：`--budget-ms=` 会被机器判「未知参数」，
    args.push(...ids);                                                 // 而它的读取器只认空格——放行连写＝给了预算却按不限跑
    const child = spawn(process.execPath, args, { cwd: resolve(tree) });
    let buf = "";
    let over = false;
    const sink = (c: Buffer): void => {
      const text = c.toString();
      try { appendFileSync(logPath, text); } catch { /* 落盘失败不许把片杀掉：判定仍从内存那份算 */ }
      if (buf.length < MAX_BUF) buf += text; else over = true;
    };
    child.stdout.on("data", sink);
    child.stderr.on("data", sink);
    child.on("error", (e) => {
      try { appendFileSync(logPath, `\nspawn 失败：${e.message}`); } catch { /* 同上 */ }
      done({ stdout: buf, status: null, spawnError: e.message });
    });
    child.on("close", (code) => done({ stdout: over ? buf + "\n❌ 输出超出缓冲上限 ⇒ 内存那份不完整（文件那份仍是全的）" : buf, status: code }));
  });
}

/** 每片原文落一个文件。第 187 页落地当场就撞上这件事的价值：两片里有一片报「基线红」，
 *  而合并层只把**类别**并成一句话——没有原文，读者只能重跑一遍去猜。
 *  路径要印出来（不是只存在内存里），否则「有日志」与「拿得到日志」又是两回事。 */
export function shardLogPath(base: string, i: number): string {
  return join(tmpdir(), `mutate-shards-${base}-${String(i)}.log`);
}

/** 装箱权重的取料：`--cost-logs` 给了就用那些文件，没给就用**本标签上一轮**的片原文
 *  （调用点保证在读完之后才截断）。一条都抽不到 ⇒ 返回空表，`planShards` 因此退回按条数装，
 *  而计划行会写「没有权重来源」——第一次跑本来就没有权重，这不叫失败，但也不许装作有权重。
 *  读不到的文件静默跳过：默认来源在首跑时就是不存在的，把它当「取料坏」会让第一次跑不起来。 */
export function costWeights(explicit: readonly string[], ownPrevLogs: readonly string[]): { weights: Map<string, number>; whence: string } {
  const sources = explicit.length > 0 ? explicit.map((p) => resolve(p)) : ownPrevLogs.map((p) => resolve(p));
  const whence = explicit.length > 0 ? "--cost-logs" : "上一轮本标签片原文";
  const merged = new Map<string, number>();
  for (const p of sources) {
    if (!existsSync(p)) continue;
    anchorCostsFromLog(readFileSync(p, "utf8"), merged); // 「同一条取最大」那份规则在取料函数里，这里不重抄
  }
  return { weights: merged, whence };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags === null) {
    if (parsed.unknown.length > 0) console.error("取料坏：认不出的参数 ⇒ 一条不跑：" + parsed.unknown.join(" "));
    if (parsed.problem !== "") console.error("取料坏：" + parsed.problem);
    console.error("用法：node --import tsx scripts/mutate-shards.ts --trees 树1,树2[,…] [--changed-since=<rev> | id…] [--budget-ms N] [--serial-seconds N] [--lock-tag-base …] [--cost-logs 机器原文,…] [--dry-run]（带值的旗标两种写法都收）");
    process.exitCode = 2;
    return;
  }
  const f = parsed.flags;
  const distinct = [...new Set(f.trees.map((t) => resolve(t)))];
  if (distinct.length !== f.trees.length) {
    console.error("取料坏：--trees 里有重复路径 ⇒ 同树两个进程会互改源文件（.mutbak 会互相踩），一条不跑");
    process.exitCode = 2;
    return;
  }
  const refused = distinct.map((t) => ({ t, why: treeProblem(t) })).filter((r) => r.why !== "");
  if (refused.length > 0) {
    for (const r of refused) console.error(`拒跑：${r.t} —— ${r.why}`);
    console.error(`取料坏：${String(refused.length)}/${String(distinct.length)} 棵树不合格 ⇒ 一条不跑（这不是「没有红」，是没尺）`);
    process.exitCode = 2;
    return;
  }

  const all = roster(distinct[0]!, f.changedSince);
  const wanted = [...new Set(f.ids)];
  const ghost = wanted.filter((id) => !all.some((r) => r.id === id));
  if (ghost.length > 0) {
    console.error(`取料坏：给了 ${String(ghost.length)} 条不在这张表上的 id ⇒ 一条不跑：${ghost.join(" ")}`);
    process.exitCode = 2;
    return;
  }
  const rows = wanted.length === 0 ? all : all.filter((r) => wanted.includes(r.id));
  if (rows.length === 0) {
    console.error("取料坏：名单为空 ⇒ 无从分片（`--list` 一条也没吐，或 rev 拼错）");
    process.exitCode = 2;
    return;
  }
  const ids = rows.map((r) => r.id);
  // **先读权重再截断**：默认权重来源就是本标签**上一轮**的片原文，而下面这些路径马上要被清空重写。
  const cost = costWeights(f.costLogs, Array.from({ length: distinct.length }, (_, i) => shardLogPath(f.lockTagBase, i)));
  const shards = f.forceSplit === "roundrobin"
    ? splitShards(ids, distinct.length)
    : planShards(rows, distinct.length, cost.weights);
  const proof = partitionProof(ids, shards);
  if (proof.missing.length > 0 || proof.duplicated.length > 0 || proof.outside.length > 0) {
    console.error(
      `取料坏：分片不是分割 ⇒ 一条不跑（缺 ${String(proof.missing.length)} 条／重 ${String(proof.duplicated.length)} 条／外来 ${String(proof.outside.length)} 条）`,
    );
    process.exitCode = 2;
    return;
  }
  // 反向证人：同一宿主被摊到两片＝两个真进程同时真跑那份判卷文件。
  // 这不是理论风险——09-29 实测轮转切法把 `tests/head-cert-deps.test.ts` 摊进四片，其中一片的
  // `cert-lock-stale-not-unlinked` 因认证树注册名（按提交 sha 定）撞车而判「基线就不是全绿」，
  // 同一条串行复跑 ⇒ `✅` 1.1s。`partitionProof` 对那种切法全绿（不重不漏），只有这一格认得出。
  const split = hostsSplitAcrossShards(rows, shards);
  if (split.length > 0) {
    console.error(`取料坏：${String(split.length)} 个判卷宿主被摊到两片以上 ⇒ 会并发真跑同一份判卷，一条不跑：${split.join(",")}`);
    process.exitCode = 2;
    return;
  }
  const counts = proof.counts.join("+");
  const logs = shards.map((_, i) => shardLogPath(f.lockTagBase, i));
  // 轮转那把观察输入不看重量 ⇒ 那一格必须说「不适用」，不许让读者以为这轮是按秒装的。
  const packCell = f.forceSplit === "roundrobin"
    ? "装箱=不适用（轮转不看重量）"
    : packingCell(rows, cost.weights) + `·源=${cost.whence}`;
  console.log(`名单 ${String(ids.length)} 条 → ${String(shards.length)} 片（${counts}）· 切法=${f.forceSplit}· ${packCell} · 每片一棵树，锁标签 ${f.lockTagBase}-<i>`);
  for (let i = 0; i < shards.length; i += 1) {
    console.log(`  片 ${String(i)}：${String(shards[i]!.length)} 条 @ ${distinct[i % distinct.length]} · 原文=${logs[i]}`);
  }
  if (f.dryRun) {
    console.log("（--dry-run：只出计划，一条没跑）");
    process.exitCode = 0;
    return;
  }

  for (const p of logs) writeFileSync(p, ""); // 先截断：边跑边 append，不截断就会把上一轮的原文续在同一份里
  const t0 = Date.now();
  const raw = await Promise.all(shards.map((sh, i) => runShard(distinct[i % distinct.length]!, sh, `${f.lockTagBase}-${String(i)}`, f.budgetMs, logs[i]!)));
  const wallSec = (Date.now() - t0) / 1000;
  const shardRows: ShardRow[] = raw.map((r, i) => shardRow(distinct[i % distinct.length]!, shards[i]!.length, r.stdout, r.status, r.spawnError));
  for (let i = 0; i < shardRows.length; i += 1) {
    const r = shardRows[i]!;
    console.log(`  判定 片 ${String(i)} ${r.tree.split("/").slice(-1)[0]}：${String(r.given)} 条 ⇒ ${r.verdict}${r.cause === "" ? "" : "（" + r.cause + "）"}${r.redIds.length === 0 ? "" : " 红行 " + r.redIds.join(",")}`);
  }
  const m = mergeShards(shardRows);
  console.log(rollupLine(m, shardRows.length, wallSec, f.serialSeconds));
  if (m.actionableIds.length > 0) console.log("待处理 id：" + m.actionableIds.join(" "));
  if (!m.allKilled) {
    process.exitCode = m.mismatchShards > 0 || shardRows.some((r) => r.verdict === "读不出") ? 2 : 1;
    return;
  }
  process.exitCode = m.mismatchShards > 0 ? 2 : 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) void main();
