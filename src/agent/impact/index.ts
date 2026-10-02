// 影响面层（M7）：对目标仓库 js/ts/jsx 抽跨文件调用边（def/ref 双端点），
// 支持向上（谁调用我）/向下（我调用谁）查询。复用 map 层的 grammar 初始化与
// tags 模式（`fileSymbols`：tags＋imports 两个出口 + {mtime,size} 磁盘缓存），不重写 tree-sitter。
// 缓存只写应用数据目录（~/.m0-agent-loop/impact-tags），绝不写进用户仓库。
// 与 map 的差异：map 静默降级（ok:false）；影响面是「改代码护栏」，grammar
// 环境级失败必须 fail-loud（ImpactUnavailableError，文案含 unavailable）。
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileSymbols, TAGS_EXTRACT_VERSION, TreeSitterUnavailableError, type ImportRef, type SymbolTag } from "../map/parse.js";
import { resolveModuleSpecifier } from "../map/import-edge.js";
import { applyFileCap, scanSourceFilesAll, type ScannedFile } from "../map/build.js";
import { MAX_FILES_CEILING, MAX_FILES_DEFAULT } from "../map/cap.js";
import { attributionNote, attributeRefToDef, bindingSourceKey, emptyAttributionStats, type AttributionStats } from "./attribution.js";
import { coverageNote, graphIsPartial } from "./coverage.js";
import { currentCommitSha, impactIndexDirFor, loadImpactIndex, saveImpactIndex } from "./persist.js";

/** grammar 环境级失败（坏/缺失 wasm）：影响面是护栏能力，必须 fail-loud。
 *  文案固定含 "unavailable"（判卷锚点）。 */
export class ImpactUnavailableError extends Error {
  override name = "ImpactUnavailableError";
}

/** 调用点/定义点：workspace 相对路径 + 1-based 行号。 */
export interface ImpactSite {
  symbol: string;
  file: string;
  line: number;
}

/** 跨文件调用边：from 文件在 refLine 处调用 symbol，其定义在 to 文件 defLine 处。 */
export interface ImpactEdge {
  from: string;
  to: string;
  symbol: string;
  refLine: number;
  defLine: number;
}

export interface ImpactGraph {
  /** 参与建图的源文件（workspace 相对，排序）。 */
  files: string[];
  /** 帽**切之前**的全量候选数（rg + 后缀过滤 + mtime 排序）。读端要靠它把「图非全量」
   *  说成带分母的一句话：`scanSourceFiles` 本来就是先取全量再 `applyFileCap` 切片，
   *  所以这个数不要第二次 rg（第 55 页「挤掉多少个要重扫全量候选，这一格不值一次 rg」
   *  那句理由在建图这一支不成立——切片就在这行发生）。 */
  candidates: number;
  /** **这一张图实际生效的帽**（`opts.maxFiles ?? MAX_FILES_DEFAULT`）。
   *  读端与回注摘要要说「＝帽 N」时用它，不许自己再解析一遍缺省——那是同族「两处各写一个数字」。 */
  cap: number;
  /** symbol → 定义点（可能多文件同名人）。 */
  defs: Map<string, ImpactSite[]>;
  /** symbol → 引用点（含同文件自引用；查询层负责过滤跨文件）。 */
  refs: Map<string, ImpactSite[]>;
  /** 跨文件调用边（from ≠ to，确定性排序）。 */
  edges: ImpactEdge[];
  /** 引用方文件 → 名字 → 该名字被绑到的来源（仓内 rel，或 `external:<说明符>`）。
   *  归属判据（`attribution.ts`）的取料面。**这一张表与 tags 同源同批**：另建一份就是
   *  第二套取料面（同族），持久化那一支漏带它 ⇒ 热载入的图会给出「无证据」满格的另一张图。 */
  nameSources: Map<string, Map<string, string[]>>;
  /** 边构造时的三态计数（kept／dropped／no-evidence）。读端要说「排除了几处」就得靠它带分母。 */
  attribution: AttributionStats;
  /** 本次实际重解析文件数（缓存未命中）。 */
  parsed: number;
  /** 本次命中 tags 缓存文件数。 */
  fromTagsCache: number;
  /** true = 本次图直接从持久化索引载入（零解析；parsed/fromTagsCache 因此为 0）。
   *  只在 `persistIndex` 开且索引命中时出现——读端可据此与「tags 缓存命中」区分开。 */
  fromIndex?: boolean;
}

export interface BuildImpactOptions {
  workspace: string;
  /** tags 缓存目录（缺省 = 应用数据目录；测试给临时目录，避免污染用户主目录）。 */
  cacheDir?: string;
  /** 文件数帽（缺省＝安全阀 `MAX_FILES_DEFAULT`，同 map——09-30 起它不再是 400，见 `map/build.ts` 那段）。 */
  maxFiles?: number;
  /** 持久化索引开关。true ⇒ 同 git 提交＋全量文件指纹命中就直接载入 artifact（零解析，
   *  `fromIndex: true`）；任一文件变化 ⇒ 走既有 tags 缓存增量、建完覆写 artifact。
   *  缺省 false：既有判卷（impact.test.ts ⑭）钉死「直接调 buildImpact 的缺省行为＝tags
   *  缓存增量」这一语义；索引这层进程级热载由装配点显式开（`impact_query` 三个建图出口）。 */
  persistIndex?: boolean;
  /** 索引目录（缺省 = cacheDir 的兄弟目录 impact-index；测试注入临时目录用）。 */
  indexDir?: string;
}

/** 帽的上限。**数值的事实源在 `map/build.ts:MAX_FILES_CEILING`**，这里只是别名——
 *  从前两处各写一个 5000/400 ⇒ 一处调、另一处静默不跟（同族：第十四族"同一谓词多份副本"）。
 *  为什么要有这一位：`maxFiles` 现在由**模型**传（`impact_query` 的读端说明让它调），
 *  没有上界就等于给它一个"解析任意多个文件"的开关——建图是每文件一次 tree-sitter 解析。
 *  取 5000 的依据是本机实测（2026-09-24，本仓 448 个候选源码冷建）：**每文件 ≈1.9ms**，
 *  cap=400 → 827ms、全量 448 → 836ms ⇒ 5000 个 ≈10s，与一次模型往返（8.7–42s）同量级，
 *  且 tags 缓存按文件 `{mtime,size}` 记账，第二次只解析新增那批。
 *  09-30 同位补测（独立进程、两种顺序各跑一次，`outputs/impact-cap-decision-2026-09-30/`）：
 *  本仓候选 512 时 帽400 中位 1071ms → 全量 1247ms ⇒ **＋176ms／次建图**（同臂散布 ≤13ms）。 */
export const IMPACT_MAX_FILES_CEILING = MAX_FILES_CEILING;

// ---- tags 磁盘缓存（同 map/build.ts 模式：{mtimeMs,size} 指纹；缓存只在 cacheDir 内）----

export function defaultImpactCacheDir(): string {
  return process.env.M7_IMPACT_TAGS_DIR ?? join(homedir(), ".m0-agent-loop", "impact-tags");
}

function cacheFileFor(dir: string, abs: string): string {
  const key = createHash("sha1").update(abs).digest("hex");
  return join(dir, key + ".json");
}

interface ImpactTagsCacheEntry {
  /** 抽取判据版本：与 map 侧同一把（`TAGS_EXTRACT_VERSION`），两份缓存各判各的但版本源只有一个。
   *  缺它 ⇒ 改 pattern 后这张图仍从盘上读回旧判据的 tags，新判据对未变更文件不生效。 */
  v: string;
  mtimeMs: number;
  size: number;
  tags: SymbolTag[];
  /** 跨文件依赖（`fileSymbols` 的第二个出口）。与 tags **同判同写**：只存 tags 的那一支
   *  会让归属判据永远拿不到证据（现象＝"改了实现，波及面一点没变"），与地图侧同一格病。 */
  imports: ImportRef[];
}

async function readTagsCache(dir: string, f: ScannedFile): Promise<{ tags: SymbolTag[]; imports: ImportRef[] } | null> {
  try {
    const raw = await readFile(cacheFileFor(dir, f.abs), "utf8");
    const e = JSON.parse(raw) as ImpactTagsCacheEntry;
    if (e.v !== TAGS_EXTRACT_VERSION) return null; // 判据换过（含旧条目无 v 字段）→ 作废
    if (e.mtimeMs === f.mtimeMs && e.size === f.size && Array.isArray(e.tags) && Array.isArray(e.imports)) {
      return { tags: e.tags, imports: e.imports };
    }
    return null; // 指纹变化 → miss（文件被改过）
  } catch {
    return null; // 无缓存/缓存损坏 → miss（下次覆写，不抛）
  }
}

async function writeTagsCache(dir: string, f: ScannedFile, tags: SymbolTag[], imports: ImportRef[]): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const entry: ImpactTagsCacheEntry = { v: TAGS_EXTRACT_VERSION, mtimeMs: f.mtimeMs, size: f.size, tags, imports };
    await writeFile(cacheFileFor(dir, f.abs), JSON.stringify(entry), "utf8");
  } catch (err) {
    // 缓存写失败不影响本次建图（下次全量重解析），与 map 同口径
    console.debug("[impact] tags 缓存写失败（忽略）:", err instanceof Error ? err.message : String(err));
  }
}

// ---- 建图 ----

function addSites(map: Map<string, ImpactSite[]>, sym: string, site: ImpactSite): void {
  const arr = map.get(sym);
  if (!arr) map.set(sym, [site]);
  else arr.push(site);
}

/** 构建跨文件调用图。增量：{mtime,size} 指纹未变的文件直接读 tags 缓存；
 *  `persistIndex` 开时再叠一层进程级热载：同 git 提交＋全量文件指纹命中 ⇒ 直接载入
 *  artifact（零解析，见 ./persist.ts）。
 *  错误契约：grammar 环境级失败（坏/缺失 wasm）抛 ImpactUnavailableError（fail-loud，
 *  文案含 unavailable）；单文件读/解析失败静默跳过（同 map）。 */
export async function buildImpact(opts: BuildImpactOptions): Promise<ImpactGraph> {
  // 帽走 build.ts 那一个常量：读端（impact_query 的分诊）报「第几位 / 收录几个」用的是同一个数，
  // 两边各写一个 400 就会一处调、另一处静默说错话。
  // 切片前后两份都要：`candidates`（帽前全量）是读端覆盖面自述的分母，取它不要第二次 rg。
  const cap = opts.maxFiles ?? MAX_FILES_DEFAULT;
  const candidates = await scanSourceFilesAll(opts.workspace);
  const files = applyFileCap(candidates, cap);
  const dir = opts.cacheDir ?? defaultImpactCacheDir();

  if (opts.persistIndex === true) {
    const wsAbs = resolve(opts.workspace);
    const sha = await currentCommitSha(opts.workspace);
    if (sha !== null) {
      const indexDir = opts.indexDir ?? impactIndexDirFor(dir);
      const loaded = await loadImpactIndex(indexDir, wsAbs, sha, files);
      if (loaded) return loaded;
      const graph = await buildGraphFromScan(candidates, files, cap, dir);
      await saveImpactIndex(indexDir, wsAbs, sha, graph, files);
      return graph;
    }
    // sha 取不到（非 git 仓/无提交）→ 落到下面：索引整层不参与（没有稳定键不发明弱键）。
  }
  return buildGraphFromScan(candidates, files, cap, dir);
}

/** 从已扫描的文件清单建图（tags 缓存增量层）。载入/落盘的编排只在 `buildImpact`，
 *  这一支保持纯建图——两层缓存（tags 文件级、索引图级）的判据互不掺和。
 *  收 candidates 全量数组只为 return 里那一个 `.length`（帽前分母的锚点针脚钉着这个字面量）。 */
async function buildGraphFromScan(
  candidates: ScannedFile[],
  files: ScannedFile[],
  cap: number,
  dir: string,
): Promise<ImpactGraph> {
  const defs = new Map<string, ImpactSite[]>();
  const refs = new Map<string, ImpactSite[]>();
  /** 引用方文件 → 名字 → 该名字被 import 绑到的来源（rel 或 `external:<说明符>`）。 */
  const nameSources = new Map<string, Map<string, string[]>>();
  const attribution = emptyAttributionStats();
  let parsed = 0;
  let fromTagsCache = 0;
  const knownFiles = new Set(files.map((f) => f.rel));

  for (const f of files) {
    let tags: SymbolTag[];
    let imports: ImportRef[];
    const hit = await readTagsCache(dir, f);
    if (hit) {
      tags = hit.tags;
      imports = hit.imports;
      fromTagsCache++;
    } else {
      let src: string;
      try {
        src = await readFile(f.abs, "utf8");
      } catch {
        console.debug(`[impact] 单文件读取失败（跳过）: ${f.rel}`);
        continue;
      }
      try {
        const ext = f.rel.slice(f.rel.lastIndexOf(".") + 1).toLowerCase();
        const sym = await fileSymbols(src, ext);
        tags = sym.tags;
        imports = sym.imports;
        parsed++;
        await writeTagsCache(dir, f, tags, imports);
      } catch (err) {
        if (err instanceof TreeSitterUnavailableError) {
          throw new ImpactUnavailableError(
            "impact: tree-sitter unavailable（grammar 加载失败，无法计算影响面；" +
              (err instanceof Error ? err.message : String(err)) +
              "）",
          );
        }
        console.debug(`[impact] 单文件解析失败（跳过）: ${f.rel}`);
        continue;
      }
    }
    for (const t of tags) {
      if (t.kind === "def") addSites(defs, t.name, { symbol: t.name, file: f.rel, line: t.line });
      else addSites(refs, t.name, { symbol: t.name, file: f.rel, line: t.line });
    }
    // 归属取料：这一份文件把每个名字 import 绑到了哪儿。**外部包也算**（`node:fs` 的那个
    // `readFile` 正是"另有出处"的反证），键的构造只在 `bindingSourceKey` 一处。
    const perFile = new Map<string, string[]>();
    for (const ir of imports) {
      const key = bindingSourceKey(resolveModuleSpecifier(f.rel, ir.spec, knownFiles), ir.spec);
      const arr = perFile.get(ir.name);
      if (arr) {
        if (!arr.includes(key)) arr.push(key);
      } else perFile.set(ir.name, [key]);
    }
    nameSources.set(f.rel, perFile);
  }

  /** 边构造 + 归属判据一起过：反证（同名但另有出处）才摘，没证据照名字图连——
   *  三态计数只在这一处发生（`upward`/`downward` 复用同一个谓词但不重复计数，
   *  否则同一件事会被两条支各数一遍，读数就成了两倍）。 */
  const seen = new Set<string>();
  const edges: ImpactEdge[] = [];
  for (const [sym, refSites] of refs) {
    const defSites = defs.get(sym);
    if (!defSites) continue;
    for (const r of refSites) {
      const binding = { known: nameSources.has(r.file), sources: nameSources.get(r.file)?.get(sym) ?? [] };
      for (const d of defSites) {
        if (d.file === r.file) continue;
        const verdict = attributeRefToDef(binding, d.file);
        if (verdict === "kept") attribution.kept++;
        else if (verdict === "dropped") attribution.dropped++;
        else attribution.noEvidence++;
        if (verdict === "dropped") continue;
        const key = [r.file, d.file, sym, r.line, d.line].join("\u241F");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: r.file, to: d.file, symbol: sym, refLine: r.line, defLine: d.line });
      }
    }
  }
  edges.sort((a, b) =>
    a.from === b.from
      ? a.to === b.to
        ? a.symbol === b.symbol
          ? a.refLine === b.refLine
            ? a.defLine - b.defLine
            : a.refLine - b.refLine
          : a.symbol.localeCompare(b.symbol)
        : a.to.localeCompare(b.to)
      : a.from.localeCompare(b.from),
  );

  // 站点清单确定性排序（symbol, file, line）：raw map 与查询层同序，可重放
  for (const list of defs.values()) list.sort(siteOrder);
  for (const list of refs.values()) list.sort(siteOrder);

  return {
    files: [...files.map((f) => f.rel)].sort(),
    candidates: candidates.length,
    cap,
    defs,
    refs,
    edges,
    nameSources,
    attribution,
    parsed,
    fromTagsCache,
  };
}

// ---- 查询：向上（谁调用我）/向下（我调用谁）----

function siteOrder(a: ImpactSite, b: ImpactSite): number {
  if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
  return a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file);
}

function sortedSites(sites: ImpactSite[]): ImpactSite[] {
  return [...sites].sort(siteOrder);
}

/** 这一处 (引用方文件, 名字) 能不能归给图里这些同名定义之一。
 *  与边构造吃**同一个**判据（`attributeRefToDef`）——两处各写一份就会漂（第十三族）。
 *  定义集合里没有任何"别处的"定义时不摘：那既不是假阳性也不是真阳性，今天的口径就这样。 */
function attributableSomewhere(graph: ImpactGraph, refFile: string, symbol: string, defFiles: ReadonlySet<string>): boolean {
  const binding = { known: graph.nameSources.has(refFile), sources: graph.nameSources.get(refFile)?.get(symbol) ?? [] };
  let candidates = 0;
  for (const defFile of defFiles) {
    if (defFile === refFile) continue;
    candidates++;
    if (attributeRefToDef(binding, defFile) !== "dropped") return true;
  }
  return candidates === 0;
}

/** 向上：跨文件调用 symbol 的位置清单（排除定义所在文件自身——「谁还在用我」）。 */
export function upward(graph: ImpactGraph, symbol: string): ImpactSite[] {
  const refSites = graph.refs.get(symbol) ?? [];
  const defFiles = new Set((graph.defs.get(symbol) ?? []).map((d) => d.file));
  return sortedSites(refSites.filter((r) => !defFiles.has(r.file) && attributableSomewhere(graph, r.file, symbol, defFiles)));
}

/** 向下：file 里引用到的、且定义在别的文件里的 symbol 的定义点清单（「我在调用谁」）。 */
export function downward(graph: ImpactGraph, file: string): ImpactSite[] {
  const out = new Set<string>();
  const sites: ImpactSite[] = [];
  for (const [sym, refList] of graph.refs) {
    const mine = refList.filter((r) => r.file === file);
    if (mine.length === 0) continue;
    const binding = { known: graph.nameSources.has(file), sources: graph.nameSources.get(file)?.get(sym) ?? [] };
    for (const d of graph.defs.get(sym) ?? []) {
      if (d.file === file) continue;
      // 与 `upward` 同一把判据，但这里是"我对面那一份定义"——按 def 逐条判，
      // 不能像 upward 那样"任一命中即留"，否则会把反证成立的那份定义也带回来。
      if (attributeRefToDef(binding, d.file) === "dropped") continue;
      const key = d.file + "\u241F" + String(d.line) + "\u241F" + d.symbol;
      if (!out.has(key)) {
        out.add(key);
        sites.push(d);
      }
    }
  }
  return sortedSites(sites);
}

// ---- loop 钩子（M7 创新点）：编辑后算该文件符号的向上影响面 ----

export const IMPACT_SITE_LIMIT = 200; // 事件里保留的调用点数量帽（面板/审计可查全量清单）

/** 回注 tool_result 的摘要预算：被广泛调用的符号单次写入会带出上百个调用点，
 *  逐条注入会把 tool_result 撑到数千 token（与「消耗 token 最少」直接冲突）。
 *  收紧为文件级汇聚 + 每文件限量符号；完整清单仍在 impact_report 事件里（面板可查）。 */
export const IMPACT_CONTEXT_FILES = 6;
export const IMPACT_CONTEXT_SYMBOLS_PER_FILE = 4;

export interface FileImpactReport {
  /** 被编辑文件（workspace 相对）。 */
  file: string;
  /** 该文件的定义符号（含局部 def——护栏宁多勿漏）。 */
  symbols: string[];
  /** 这些符号的跨文件调用点（限量）。 */
  up: ImpactSite[];
  /** 命中数量帽（true = 还有更多调用点未列出）。 */
  truncated: boolean;
  /** 这张图实际收录了多少个文件 —— 读端要靠它自述覆盖面：
   *  被帽截断时「波及 1 个文件」与「图只扫了仓库的一小截」在答案里长一模一样。 */
  graphFiles: number;
  /** 帽切之前的全量候选数（同 `ImpactGraph.candidates`，一路带到读端当分母）。
   *  不带它，file 支只能说「非全量」而说不出漏了几个 —— 三支自述里只有这一支的数
   *  要穿过 `fileImpact` 这一层，少接一层就是那一支静默回到没有分母的旧句子。 */
  graphCandidates: number;
  /** 这一张图生效的帽（同 `ImpactGraph.cap`）。注入摘要要说「＝帽 N」，就得知道 N 是几——
   *  少带这一位，回注那一侧要出声只能自己再解析一遍缺省（同族「两处各写一个数字」）。 */
  graphCap: number;
  /** 本文件的定义符号里，哪些**在别的文件也有一份同名定义**（按名字顺序）。
   *  符号图按名字连边 ⇒ 这些符号的向上清单是**各份定义的并集**，
   *  里面可能混着"另一份定义的调用方"。读端不点名，模型就无从知道该收窄。 */
  ambiguousSymbols: string[];
  /** 建这张图时边构造的三态归属计数（读端要说"排除了几处／几处没证据可判"就靠它带分母）。 */
  attribution: AttributionStats;
}

/** 计算单个被编辑文件的影响面。文件不在图内（未扫描/不支持后缀/不存在）→ null（不发事件）。
 *  grammar 环境级失败 → 抛 ImpactUnavailableError（调用方按 fail-loud 处理）。
 *  `maxFiles` 是给**读端**留的透传位：`impact_query` 的三个建图出口必须吃同一个帽，
 *  少接一支就等于那支静默按缺省建图，而同一句说明会对不同输入报出不同的数。 */
export async function fileImpact(
  workspace: string,
  fileRel: string,
  cacheDir?: string,
  maxFiles?: number,
  persistIndex?: boolean,
): Promise<FileImpactReport | null> {
  const graph = await buildImpact({ workspace, cacheDir, maxFiles, persistIndex });
  const normalized = fileRel.replace(/\\/g, "/");
  if (!graph.files.includes(normalized)) return null;
  const symbols = [...graph.defs.keys()]
    .filter((sym) => (graph.defs.get(sym) ?? []).some((d) => d.file === normalized))
    .sort();
  const all: ImpactSite[] = [];
  for (const sym of symbols) all.push(...upward(graph, sym));
  // 同名歧义：这个符号在别的文件也有一份定义 ⇒ 它的 upward 清单里混着"那份定义的调用方"。
  const ambiguousSymbols = symbols.filter(
    (sym) => new Set((graph.defs.get(sym) ?? []).map((d) => d.file)).size > 1,
  );
  const up = sortedSites(all);
  const truncated = up.length > IMPACT_SITE_LIMIT;
  return {
    file: normalized,
    symbols,
    up: truncated ? up.slice(0, IMPACT_SITE_LIMIT) : up,
    truncated,
    graphFiles: graph.files.length,
    graphCandidates: graph.candidates,
    graphCap: graph.cap,
    ambiguousSymbols,
    attribution: graph.attribution,
  };
}

/** loop 注入的缺省钩子（verify 的 ExecFn 同族接口）：write_file/edit_file 成功后调用。
 *  返回 null = 不发事件（文件不在图内）；抛错 = loop 记 debug、跳过事件、loop 继续。 */
export type ImpactHook = (
  fileRel: string,
) => Promise<{ event: import("../../events").ImpactReportEvent; contextNote: string } | null>;

/** 把调用点汇聚成紧凑摘要（文件级去重 + 每文件限量符号 + 文件限量）。
 *  膨胀度量：旧实现逐条注入最多 IMPACT_SITE_LIMIT 行 `symbol <- file:line`，
 *  广泛调用符号的单次写入输出可达数千 token；新实现按文件归并，
 *  上限约 IMPACT_CONTEXT_FILES * (IMPACT_CONTEXT_SYMBOLS_PER_FILE + 计数尾) 行。 */
export function contextNoteFor(r: FileImpactReport): string {
  /* 覆盖面自述与查询端**共用同一把尺**（`impact/coverage.ts`）：图非全量时，这一句里的 N
   * 本身就是被帽切过的 ⇒ 不带上它，"波及 1 个文件"与"图只扫了仓库的一小截"在注入面长同一个样。
   *  缺省帽已是安全阀（`MAX_FILES_DEFAULT`），正常仓库收全 ⇒ 这一句今天多半为空，
   *  空的时候不改任何一个字节（有反向对照判卷钉着）。 */
  const cov = coverageNote(r.graphFiles, r.graphCap, r.graphCandidates);
  if (r.up.length === 0) {
    // 这条是**最常见**分支（改到没有跨文件引用的文件），而 symbols 含函数内局部名（base/boosted…），
    // 大文件能上百个 ⇒ 注入面按每文件符号帽收窄；全量仍在 impact_report 事件的 symbols 里（面板/审计不丢）。
    const cap = IMPACT_CONTEXT_SYMBOLS_PER_FILE;
    const listed = r.symbols.slice(0, cap).join(", ");
    const tail = r.symbols.length > cap ? ` 等 ${String(r.symbols.length)} 个（全量在 impact_report 事件）` : "";
    return `[impact] ${r.file}：定义符号 ${r.symbols.length ? listed + tail : "（无）"}，无跨文件调用点（波及半径为 0）` + cov;
  }
  const byFile = new Map<string, { symbol: string; line: number }[]>();
  for (const s of r.up) {
    let arr = byFile.get(s.file);
    if (!arr) {
      arr = [];
      byFile.set(s.file, arr);
    }
    arr.push({ symbol: s.symbol, line: s.line });
  }
  const files = [...byFile.keys()];
  const shown = files.slice(0, IMPACT_CONTEXT_FILES);
  // 同名歧义要说在**这句旁边**。此前它只在查询端（`tools/impact-query.ts`）那句里出现，而这条是
  // **缺省开**的写后回注（`settings.ts` 的 `impactAnalysis: true`）⇒ 模型只读到「波及 M 个文件」就会照着去动那 M 个文件，
  // 而 M 里可能混着"别处同名"的调用方（真仓读数：一个 `private readFile` 吸进 107 个文件的同名 ref）。
  // 同一份事实只在一个消费者嘴里说，是本仓反复判死的"只硬化一支"形状。
  // 归属计数（`attributionNote`）接在这句**之后**：那句是"有同名定义"的结构事实，这句是"这一张图判掉了多少"的
  // 度量事实——两者独立出现，摘掉任一都不许让另一句跟着变（判卷按两态各钉一条）。
  const ambiguity = (r.ambiguousSymbols.length > 0
    ? `；其中 ${String(r.ambiguousSymbols.length)} 个符号在别的文件也有同名定义，波及数按名字图算 ⇒ 清单里可能混有无关文件`
    : "") + attributionNote(r.attribution);
  const lines: string[] = [
    `[impact] ${r.file} 定义符号的跨文件调用点（上 ${r.up.length}${r.truncated ? "+" : ""}，波及 ${files.length} 个文件${ambiguity}；完整清单见 impact_report 事件）：`,
  ];
  for (const f of shown) {
    const arr = byFile.get(f)!;
    const syms = arr
      .slice(0, IMPACT_CONTEXT_SYMBOLS_PER_FILE)
      .map((s) => `${s.symbol}(L${s.line})`)
      .join(", ");
    const tail = arr.length > IMPACT_CONTEXT_SYMBOLS_PER_FILE ? ` 等 ${arr.length} 处` : "";
    lines.push(`  ${f}: ${syms}${tail}`);
  }
  if (files.length > shown.length) {
    lines.push(`  \u2026另有 ${files.length - shown.length} 个文件未列出（完整调用点清单在 impact_report 事件里）`);
  }
  return lines.join("\n") + cov;
}

export function defaultImpactHook(workspace: string, cacheDir?: string): ImpactHook {
  return async (fileRel: string) => {
    const r = await fileImpact(workspace, fileRel, cacheDir);
    if (r === null) return null;
    return {
      event: {
        type: "impact_report",
        file: r.file,
        symbols: r.symbols,
        up: r.up,
        truncated: r.truncated,
      },
      contextNote: contextNoteFor(r),
    };
  };
}

// ---- B1：把影响面从「回注给模型看的提示」升级成 spawn 准入判据 ----
// 依据：多 agent 最大的未解项不是行冲突而是**写时语义冲突**（worktree 只解决物理层）。
// 两个 worker 各改各的文件、glob 不相交，却都波及同一批调用点 ⇒ 合并时照样打架。
// 这份数据在 M7 只用了一次（写后回注摘要），这里让它第二次变现。

/** glob → 仓库相对路径匹配（`**` 跨目录、`*` 段内、`?` 单字符）。 */
export function globMatchesPath(glob: string, path: string): boolean {
  const g = glob.replace(/\\/g, "/");
  const p = path.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        re += ".*";
        i++;
        if (g[i + 1] === "/") i++; // `**/` 允许匹配零段目录
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\^$.|+()[]{}".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$").test(p);
}

/** 声明「要写这些 glob」⇒ 实际会波及哪些文件（含被声明文件自身，排序去重）。
 *  grammar/索引不可用 ⇒ 抛 ImpactUnavailableError（调用方按降级处理，不静默返回空集）。
 *
 *  「图非全量」必须**出声**（09-30 补，第 201 页的实测）：这一支的返回值直接进 spawn 准入——
 *  `semanticConflictsVia` 见空波及就 `return []`，其理由「无跨文件调用点，宁漏不误伤」**默认图是全的**，
 *  而 orchestrator 冲突 0 条时连审批卡都不发。从前钩子抛错会 `console.warn`、缺料什么都不说
 *  ⇒ 故障出声、缺料不出声。`maxFiles` 是给读端/判卷留的透传位（同 `fileImpact`）：生产缺省已是
 *  安全阀上限，正常仓库不会走到那句出声。 */
export async function affectedFilesOf(
  workspace: string,
  globs: readonly string[],
  cacheDir?: string,
  maxFiles?: number,
): Promise<string[]> {
  if (globs.length === 0) return [];
  const graph = await buildImpact({ workspace, cacheDir, maxFiles });
  if (graphIsPartial(graph.files.length, graph.candidates)) {
    console.warn(
      `[impact] 语义租约：本图收录 ${String(graph.files.length)} 个文件＝帽 ${String(graph.cap)}，` +
        `另有 ${String(graph.candidates - graph.files.length)} 个候选没进这张图（非全量）` +
        "⇒ 下面的波及闭包可能不完整，**空波及不等于无冲突**",
    );
  }
  const out = new Set<string>();
  for (const file of graph.files) {
    if (!globs.some((g) => globMatchesPath(g, file))) continue;
    out.add(file);
    for (const sym of graph.defs.keys()) {
      if (!(graph.defs.get(sym) ?? []).some((d) => d.file === file)) continue;
      for (const site of upward(graph, sym)) out.add(site.file);
    }
  }
  return [...out].sort();
}
