// 影响面层（M7）：对目标仓库 js/ts/jsx 抽跨文件调用边（def/ref 双端点），
// 支持向上（谁调用我）/向下（我调用谁）查询。复用 map 层的 grammar 初始化与
// tags 模式（fileTags + {mtime,size} 磁盘缓存），不重写 tree-sitter。
// 缓存只写应用数据目录（~/.m0-agent-loop/impact-tags），绝不写进用户仓库。
// 与 map 的差异：map 静默降级（ok:false）；影响面是「改代码护栏」，grammar
// 环境级失败必须 fail-loud（ImpactUnavailableError，文案含 unavailable）。
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileTags, TAGS_EXTRACT_VERSION, TreeSitterUnavailableError, type SymbolTag } from "../map/parse.js";
import { MAX_FILES_DEFAULT, scanSourceFiles, type ScannedFile } from "../map/build.js";

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
  /** symbol → 定义点（可能多文件同名人）。 */
  defs: Map<string, ImpactSite[]>;
  /** symbol → 引用点（含同文件自引用；查询层负责过滤跨文件）。 */
  refs: Map<string, ImpactSite[]>;
  /** 跨文件调用边（from ≠ to，确定性排序）。 */
  edges: ImpactEdge[];
  /** 本次实际重解析文件数（缓存未命中）。 */
  parsed: number;
  /** 本次命中 tags 缓存文件数。 */
  fromTagsCache: number;
}

export interface BuildImpactOptions {
  workspace: string;
  /** tags 缓存目录（缺省 = 应用数据目录；测试给临时目录，避免污染用户主目录）。 */
  cacheDir?: string;
  /** 文件数帽（缺省 400，同 map）。 */
  maxFiles?: number;
}

/** 帽的上限。为什么要有这一位：`maxFiles` 现在由**模型**传（`impact_query` 的读端说明让它调），
 *  没有上界就等于给它一个"解析任意多个文件"的开关——建图是每文件一次 tree-sitter 解析。
 *  取 5000 的依据是本机实测（2026-09-24，本仓 448 个候选源码冷建）：**每文件 ≈1.9ms**，
 *  cap=400 → 827ms、全量 448 → 836ms ⇒ 5000 个 ≈10s，与一次模型往返（8.7–42s）同量级，
 *  且 tags 缓存按文件 `{mtime,size}` 记账，第二次只解析新增那批。 */
export const IMPACT_MAX_FILES_CEILING = 5000;

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
}

async function readTagsCache(dir: string, f: ScannedFile): Promise<SymbolTag[] | null> {
  try {
    const raw = await readFile(cacheFileFor(dir, f.abs), "utf8");
    const e = JSON.parse(raw) as ImpactTagsCacheEntry;
    if (e.v !== TAGS_EXTRACT_VERSION) return null; // 判据换过（含旧条目无 v 字段）→ 作废
    if (e.mtimeMs === f.mtimeMs && e.size === f.size && Array.isArray(e.tags)) return e.tags;
    return null; // 指纹变化 → miss（文件被改过）
  } catch {
    return null; // 无缓存/缓存损坏 → miss（下次覆写，不抛）
  }
}

async function writeTagsCache(dir: string, f: ScannedFile, tags: SymbolTag[]): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const entry: ImpactTagsCacheEntry = { v: TAGS_EXTRACT_VERSION, mtimeMs: f.mtimeMs, size: f.size, tags };
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

/** 构建跨文件调用图。增量：{mtime,size} 指纹未变的文件直接读 tags 缓存。
 *  错误契约：grammar 环境级失败（坏/缺失 wasm）抛 ImpactUnavailableError（fail-loud，
 *  文案含 unavailable）；单文件读/解析失败静默跳过（同 map）。 */
export async function buildImpact(opts: BuildImpactOptions): Promise<ImpactGraph> {
  // 帽走 build.ts 那一个常量：读端（impact_query 的分诊）报「第几位 / 收录几个」用的是同一个数，
  // 两边各写一个 400 就会一处调、另一处静默说错话。
  const files = await scanSourceFiles(opts.workspace, opts.maxFiles ?? MAX_FILES_DEFAULT);
  const dir = opts.cacheDir ?? defaultImpactCacheDir();
  const defs = new Map<string, ImpactSite[]>();
  const refs = new Map<string, ImpactSite[]>();
  let parsed = 0;
  let fromTagsCache = 0;

  for (const f of files) {
    let tags: SymbolTag[] | null;
    const hit = await readTagsCache(dir, f);
    if (hit) {
      tags = hit;
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
        tags = await fileTags(src, ext);
        parsed++;
        await writeTagsCache(dir, f, tags);
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
  }

  // 跨文件调用边：ref 点所在文件 ≠ def 点所在文件（同文件自调用不是「影响面」）
  const seen = new Set<string>();
  const edges: ImpactEdge[] = [];
  for (const [sym, refSites] of refs) {
    const defSites = defs.get(sym);
    if (!defSites) continue;
    for (const r of refSites) {
      for (const d of defSites) {
        if (d.file === r.file) continue;
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
    defs,
    refs,
    edges,
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

/** 向上：跨文件调用 symbol 的位置清单（排除定义所在文件自身——「谁还在用我」）。 */
export function upward(graph: ImpactGraph, symbol: string): ImpactSite[] {
  const refSites = graph.refs.get(symbol) ?? [];
  const defFiles = new Set((graph.defs.get(symbol) ?? []).map((d) => d.file));
  return sortedSites(refSites.filter((r) => !defFiles.has(r.file)));
}

/** 向下：file 里引用到的、且定义在别的文件里的 symbol 的定义点清单（「我在调用谁」）。 */
export function downward(graph: ImpactGraph, file: string): ImpactSite[] {
  const out = new Set<string>();
  const sites: ImpactSite[] = [];
  for (const [sym, refList] of graph.refs) {
    const mine = refList.filter((r) => r.file === file);
    if (mine.length === 0) continue;
    for (const d of graph.defs.get(sym) ?? []) {
      if (d.file === file) continue;
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
): Promise<FileImpactReport | null> {
  const graph = await buildImpact({ workspace, cacheDir, maxFiles });
  const normalized = fileRel.replace(/\\/g, "/");
  if (!graph.files.includes(normalized)) return null;
  const symbols = [...graph.defs.keys()]
    .filter((sym) => (graph.defs.get(sym) ?? []).some((d) => d.file === normalized))
    .sort();
  const all: ImpactSite[] = [];
  for (const sym of symbols) all.push(...upward(graph, sym));
  const up = sortedSites(all);
  const truncated = up.length > IMPACT_SITE_LIMIT;
  return {
    file: normalized,
    symbols,
    up: truncated ? up.slice(0, IMPACT_SITE_LIMIT) : up,
    truncated,
    graphFiles: graph.files.length,
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
  if (r.up.length === 0) {
    // 这条是**最常见**分支（改到没有跨文件引用的文件），而 symbols 含函数内局部名（base/boosted…），
    // 大文件能上百个 ⇒ 注入面按每文件符号帽收窄；全量仍在 impact_report 事件的 symbols 里（面板/审计不丢）。
    const cap = IMPACT_CONTEXT_SYMBOLS_PER_FILE;
    const listed = r.symbols.slice(0, cap).join(", ");
    const tail = r.symbols.length > cap ? ` 等 ${String(r.symbols.length)} 个（全量在 impact_report 事件）` : "";
    return `[impact] ${r.file}：定义符号 ${r.symbols.length ? listed + tail : "（无）"}，无跨文件调用点（波及半径为 0）`;
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
  const lines: string[] = [
    `[impact] ${r.file} 定义符号的跨文件调用点（上 ${r.up.length}${r.truncated ? "+" : ""}，波及 ${files.length} 个文件；完整清单见 impact_report 事件）：`,
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
  return lines.join("\n");
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
 *  grammar/索引不可用 ⇒ 抛 ImpactUnavailableError（调用方按降级处理，不静默返回空集）。 */
export async function affectedFilesOf(
  workspace: string,
  globs: readonly string[],
  cacheDir?: string,
): Promise<string[]> {
  if (globs.length === 0) return [];
  const graph = await buildImpact({ workspace, cacheDir });
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
