/** 变异表分片的**切**与**并**（纯函数，供 `tests/mutate-shards.test.ts` 消费；不碰盘、不起进程）。
 *
 * 为什么这一层值得存在（任务 #18，2026-09-29 实测）：整表串行 `991 条 ≈ 19 分钟`，
 * 而实测 4 路并发（4 棵干净树、各自 `--lock-tag`）给到 **2.38×**——收益是真的，
 * 但合并这步以前没人做过：四份日志靠人眼读，于是「一片崩了」与「一片全绿」在读者眼里长得一样。
 * 本层的职责就是把那一步变成判据：**分片必须证分割**（少一条／重一条都要出声），
 * **合并必须保留三态**（已杀死／判红／读不出），读不出不许并进 0。
 *
 * 归类**不重写**：直接吃 `mutation-rerun-triage` 的 `classify`（它已经区分 spawn 失败／无退出码／
 * 无可认汇总行，并从 `REDKINDS=` 那一行认类别）。在这里再写一份正则就是第十三族——
 * 同一谓词两份副本、改一句文案就静默分叉（规则 205/213）。
 */
import { classify, failedIds, failedLineCount, looseFailedLineCount, type TriageVerdict } from "./mutation-rerun-triage";

/** 轮转切分：第 i 条进第 `i % k` 片。
 *  ⚠️ 这一把尺**只给"显式给了 id、不知道宿主"的那种调用兜底**。整表分片要用 `planShards`（按判卷宿主成组）：
 *  09-29 实测轮转把 `tests/head-cert-deps.test.ts` 名下那 47 条摊到四片，四棵真树同时真跑 head-cert，
 *  而 head-cert 的认证树名按**提交 sha** 定 ⇒ 注册到同一个 `.git/worktrees` 键上，其中一片当场
 *  「基线就不是全绿」（串行复跑同一条 ⇒ `✅` 1.1s，见 `outputs/mutation-parallel-shard-2026-09-29/measurements.md`）。 */
export function splitShards<T>(items: readonly T[], shards: number): T[][] {
  if (!Number.isInteger(shards) || shards < 1) throw new Error(`分片数必须是 ≥1 的整数，收到 ${String(shards)}`);
  const out: T[][] = Array.from({ length: Math.min(shards, items.length) }, () => []);
  items.forEach((it, i) => { out[i % out.length]!.push(it); });
  return out;
}

/** 一行取料：`--list` 协议的第 1 列（id）＋第 4 列（判卷文件＝宿主）。 */
export interface RosterRow {
  id: string;
  host: string;
}

/** 按宿主成组（保持名单里的原始顺序，便于复跑同一片时逐条可比）。 */
export function groupByHost(rows: readonly RosterRow[]): { host: string; ids: string[] }[] {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const cur = map.get(r.host);
    if (cur === undefined) {
      map.set(r.host, [r.id]);
      order.push(r.host);
    } else cur.push(r.id);
  }
  return order.map((host) => ({ host, ids: map.get(host)! }));
}

/** 分片＝**把整组宿主塞进某一片**（重的优先、给当前最空的片），所以一个宿主不会跨片。
 *  为什么按宿主成组而不是按条数轮转（09-29 实测）：
 *  ① 同宿主的判卷文件在同一时刻只该被一棵树真跑——head-cert 那一族会撞共享的 git worktree 注册表；
 *  ② 顺带把「一片只跑一个宿主的一段」变成常态，同宿主的锚点单价相近，片时长因此更平。
 *  条数少于片数时不造空片（空片＝「跑了 0 条且全绿」那种假读数）。
 *
 *  `weights`（第 192 页，任务 #28）＝每条锚点的实测秒。给了就按**秒**装箱，不给按**条数**。
 *  动因是现读：整表 4 片各 252 条，跑出来 323.6／391.1／419.9／443.0s（极差 +37%），
 *  而 09-29 那次派生 94 条里 p90 以上那 10.6% 的条数占掉 36.3% 的时间 ⇒ 条数不是重量，长尾才是。
 *  名单里缺权重的条按**已知权重的中位**补（不是 0：把没量过的条当免费，恰好会让重物叠在同一片上）。 */
export function planShards(
  rows: readonly RosterRow[],
  shards: number,
  weights: ReadonlyMap<string, number> | null = null,
): string[][] {
  if (!Number.isInteger(shards) || shards < 1) throw new Error(`分片数必须是 ≥1 的整数，收到 ${String(shards)}`);
  const useWeights = weights !== null && weights.size > 0;
  const fallback = useWeights ? fallbackSecondsOf(weights) : 1;
  const groups = groupByHost(rows);
  const cost = useWeights
    ? (g: { ids: string[] }) => g.ids.reduce((a, id) => a + (weights.get(id) ?? fallback), 0)
    : (g: { ids: string[] }) => g.ids.length;
  const sorted = [...groups].sort((a, b) => cost(b) - cost(a));
  const k = Math.min(shards, sorted.length);
  const out: string[][] = Array.from({ length: k }, () => []);
  const load: number[] = Array.from({ length: k }, () => 0);
  for (const g of sorted) {
    let target = 0;
    for (let i = 1; i < out.length; i += 1) if (load[i]! < load[target]!) target = i;
    out[target]!.push(...g.ids);
    load[target]! += cost(g);
  }
  return out;
}

/** 缺权重时按多少秒补＝**已知权重的中位**。单列一份，好让装箱与那句声明读同一个数（判卷不许自己再算一遍）。 */
export function fallbackSecondsOf(weights: ReadonlyMap<string, number>): number {
  const nums = [...weights.values()].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (nums.length === 0) return 1;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid]! : ((nums[mid - 1] ?? 0) + (nums[mid] ?? 0)) / 2;
}

/** 从机器原文抽「每条锚点的实测秒」——第 191 页那一格的第一个读者。
 *  认的是**行尾那一格**的形状：`｜本机实测 N.Ns／K 拍$`，id 取**最近一条结果行的行首**
 *  （第 193 页整表实测：1018 条里有 1 条 `impact-closure-glob-broken` 的 desc 含真换行，
 *  成本格因此挂在没有 id 的续行上——**desc 换行是合法内容，不许为了让尺好读去改它**，所以尺自己记住 id）。
 *  仍然要行尾锚定：描述里引用同样字面不算读数（规则 264：被度量者的文案＝第二注入面）。
 *  `一次没跑 ⇒ 这一格没有分母`那一态**不进表**——进表就是把没量过的条当 0 秒装（规则 245）。
 *  同一条多次出现取**最大值**：装箱宁可高估长尾，低估会把两个重物叠进同一片，而墙钟由最慢那片决定。
 *  `into` 让多份原文并进同一张表（编排器读上一轮的多个片文件）——**取最大的规则只许有一份**（规则 205/213）。 */
export function anchorCostsFromLog(text: string, into: Map<string, number> = new Map<string, number>()): Map<string, number> {
  let current = "";
  for (const line of text.split("\n")) {
    const head = /^\S+ (\S+) — /u.exec(line);
    if (head !== null) current = head[1]!;
    const tail = /｜本机实测 ([0-9.]+)s／\d+ 拍$/u.exec(line);
    if (tail === null || current === "") continue;
    const prev = into.get(current);
    const sec = Number(tail[1]);
    if (prev === undefined || sec > prev) into.set(current, sec);
  }
  return into;
}

/** 装箱那一格怎么说自己：用了权重就说来源与缺口，没用就说没用。
 *  「缺多少条按中位补」必须印出来——不印的话，读者会把这份计划当成全量实测过的。
 *  `sources`＝**调用方显式给的**权重来源文件数（`--cost-logs`）。没给时编排器读的是派生面（上一轮本标签的片原文），
 *  第一次跑那些文件本来就不在盘上——那不算"给了却读不出"，所以派生面不许计入这一位（09-30 我第一版就错并了这两态）。
 *  这一位以前只有「没权重来源」一种说法，于是「给了文件、却一条权重也没抽出」
 *  （09-30 实测两次踩中：把编排器汇总页当分片原文喂进去）被读成「没给」——
 *  而读者看到同一行末尾还写着 `源=--cost-logs`，两句互相抵消，退化就静默了（规则 258/261）。 */
export function packingCell(rows: readonly RosterRow[], weights: ReadonlyMap<string, number> | null, sources = 0): string {
  if (weights === null || weights.size === 0) {
    return sources === 0
      ? "装箱=条数（没有权重来源）"
      : `装箱=条数（给了 ${String(sources)} 个权重来源文件、抽出 0 条 ⇒ 这一趟不是按实测秒装的）`;
  }
  const ids = new Set(rows.map((r) => r.id));
  const known = [...ids].filter((id) => weights.has(id)).length;
  const missing = ids.size - known;
  return `装箱=实测秒（权重 ${String(known)}/${String(ids.size)} 条` +
    (missing === 0 ? "）" : `·缺 ${String(missing)} 条按中位 ${fallbackSecondsOf(weights).toFixed(2)}s 补）`);
}


/** 反向证人：**哪些宿主的条被摊到了两片以上**。空数组＝分片没有把同一宿主拆开。
 *  这把尺必须独立存在：`planShards` 若退化成轮转，`partitionProof` 仍然全绿（不重不漏），
 *  只有这里会红——而 head-cert 那一族的撞窗正是它才认得出的（规则 248 的「恰好 1 条」同族）。 */
export function hostsSplitAcrossShards(rows: readonly RosterRow[], shards: readonly (readonly string[])[]): string[] {
  const hostOf = new Map(rows.map((r) => [r.id, r.host]));
  const seenIn = new Map<string, Set<number>>();
  shards.forEach((sh, i) => {
    for (const id of sh) {
      const h = hostOf.get(id);
      if (h === undefined) continue;
      const set = seenIn.get(h) ?? new Set<number>();
      set.add(i);
      seenIn.set(h, set);
    }
  });
  return [...seenIn.entries()].filter(([, set]) => set.size > 1).map(([h]) => h).sort();
}

export interface PartitionProof<T> {
  /** 输入里有、分片里没有的条＝**漏跑**（这是最坏的一类：读者以为整表跑过）。 */
  missing: T[];
  /** 出现在两片以上的条＝**重跑**（分片不互斥，总数会虚高）。 */
  duplicated: T[];
  /** 分片里有、输入里没有的条＝**凭空多出来的目标**。 */
  outside: T[];
  counts: number[];
}

/** 分片自检：把"是不是分割"变成三个数，而不是"看起来差不多"。
 *  空 missing 不等于没问题——重跑与外来的条同样让总数对不上，所以要三个都核。 */
export function partitionProof<T>(input: readonly T[], shards: readonly (readonly T[])[]): PartitionProof<T> {
  const seen = new Map<T, number>();
  for (const sh of shards) for (const it of sh) seen.set(it, (seen.get(it) ?? 0) + 1);
  const inSet = new Set(input);
  return {
    missing: input.filter((it) => !seen.has(it)),
    duplicated: [...seen.entries()].filter(([, n]) => n > 1).map(([it]) => it),
    outside: [...seen.keys()].filter((it) => !inSet.has(it)),
    counts: shards.map((sh) => sh.length),
  };
}

/** 一片的读数。`verdict` 直接来自 `classify`（不在这儿重新认类别）。 */
export interface ShardRow {
  tree: string;
  /** 这一片**被交给**的条数（不是机器自报跑了几条——机器那行是给人看的散文，见 `rollupLine` 的成本格）。 */
  given: number;
  verdict: TriageVerdict;
  cause: string;
  /** 这一片里 ❌ 行的 id（`failedIds` 已去重）。 */
  redIds: string[];
  /** 严格抽取数 vs 宽松行数：不等＝日志形状与抽取器对不上，这一片的"没有红"不可信（规则 180）。 */
  extractMismatch: boolean;
}

export function shardRow(tree: string, given: number, stdout: string, status: number | null, spawnError?: string): ShardRow {
  const c = classify(stdout, status, spawnError);
  return {
    tree,
    given,
    verdict: c.verdict,
    cause: c.cause === "" ? c.note : c.cause,
    redIds: failedIds(stdout),
    extractMismatch: failedLineCount(stdout) !== looseFailedLineCount(stdout),
  };
}

export const VERDICT_ORDER: readonly TriageVerdict[] = ["已杀死", "存活", "红了未点名", "基线红", "未生效", "读不出"];

export interface MergedRollup {
  byVerdict: Record<TriageVerdict, number>;
  /** 交出去的总条数（各片 `given` 之和）。 */
  givenTotal: number;
  /** 「已杀死」那片段的条数和——**只在所有片都判定为已杀死时**才等于 givenTotal。 */
  killedTotal: number;
  /** 要人处理的条（存活／红了未点名／读不出）：沿用 triage 那张 ACTIONABLE 表，不在这儿另列一份。 */
  actionableIds: string[];
  /** 有任意一片没判成「已杀死」⇒ 整跑不许退 0。 */
  allKilled: boolean;
  /** 抽取器与日志形状不一致的片数（>0 时上面的数都打折）。 */
  mismatchShards: number;
}

/** 合并：三态分开计数，**读不出不并进 0**（规则 239：半把尺与没尺要各自看得见）。 */
export function mergeShards(rows: readonly ShardRow[]): MergedRollup {
  const byVerdict = Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0])) as Record<TriageVerdict, number>;
  const actionable: string[] = [];
  let givenTotal = 0;
  let killedTotal = 0;
  let mismatch = 0;
  for (const r of rows) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    givenTotal += r.given;
    if (r.verdict === "已杀死") killedTotal += r.given;
    if (r.verdict === "存活" || r.verdict === "红了未点名" || r.verdict === "读不出") actionable.push(...r.redIds);
    if (r.extractMismatch) mismatch += 1;
  }
  return {
    byVerdict,
    givenTotal,
    killedTotal,
    actionableIds: [...new Set(actionable)],
    allKilled: rows.length > 0 && rows.every((r) => r.verdict === "已杀死"),
    mismatchShards: mismatch,
  };
}

/** 读数行的形状单独成函数：判卷要钉的是**接线**（谁把哪些数喂进这一行），
 *  而不是一句文案的位置（规则 236：同文件文字判卷会恒真）。 */
export function rollupLine(m: MergedRollup, shards: number, wallSec: number, serialSec: number | null): string {
  const kinds = VERDICT_ORDER.filter((v) => (m.byVerdict[v] ?? 0) > 0)
    .map((v) => `${v}:${String(m.byVerdict[v] ?? 0)}`)
    .join(" ");
  const speed = serialSec === null || serialSec <= 0
    ? "没有串行分母 ⇒ 不报加速比（这句不是「并行没省时」，是没尺）"
    : `加速比 ${(serialSec / wallSec).toFixed(2)}×（串行分母 ${serialSec.toFixed(1)}s 由参数给出）`;
  return (
    `分片 ${String(shards)} 份 · 交出 ${String(m.givenTotal)} 条 · 墙钟 ${wallSec.toFixed(1)}s · 判定[${kinds === "" ? "无" : kinds}] · ` +
    `已杀死那几片合计 ${String(m.killedTotal)} 条 · 待处理 ${String(m.actionableIds.length)} 条 · ${speed}` +
    (m.mismatchShards > 0 ? ` · ⚠️ ${String(m.mismatchShards)} 片的红行抽取对不上，上面的数打折读` : "")
  );
}
