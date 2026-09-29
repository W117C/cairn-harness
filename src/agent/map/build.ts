// 符号地图·构建与缓存（§6.4）：工作区扫描 → per-file tags（{mtime,size} 缓存于应用数据目录，
// 绝不进用户仓库）→ 加权图 → 个性化 PageRank → 预算渲染。渲染结果按（上下文文件签名、
// mentioned_idents、预算）内存缓存：指纹不变复用上一张图，指纹变化或每 N 轮重算。
// 任何一步异常 → 静默降级：返回空地图、记 debug 日志，绝不阻断 loop（§6.4 失败降级）。
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { rgBinary } from "../../tools/ripgrep.js";
import { sanitizedEnv } from "../../tools/process.js";
import { fileTags, SUPPORTED_EXTS, TAGS_EXTRACT_VERSION, TreeSitterUnavailableError, type SymbolTag } from "./parse.js";
import { buildGraph, personalizedPageRank, type FileTagsInput } from "./rank.js";
import { clampBudget, renderMapBudget } from "./render.js";
import { MAX_FILES_DEFAULT } from "./cap.js";
import { coverageNote } from "../impact/coverage.js";

const NOISE_GLOBS = ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/out/**"];
// 文件数帽那两个数住在 `./cap.js`（唯一事实源）。为什么不在这里：`impact/coverage.ts` 的文案
// 要吃同一个上限，而文案模块被地图这一侧复用 ⇒ 常量留在本文件就会成环（说明见 cap.ts 头注）。
const RECOMPUTE_EVERY_DEFAULT = 10;

export interface TagsCacheEntry {
  /** 抽取判据版本（`parse.ts` 从 PATTERNS 派生）。指纹相同但版本不同 ⇒ 按 miss 重解析：
   *  没有这一条，改 pattern 对**未变更的文件**永远不生效，现象是「改了没反应」。 */
  v: string;
  mtimeMs: number;
  size: number;
  tags: SymbolTag[];
}

export interface ScannedFile {
  /** workspace 相对路径（统一口径）。 */
  rel: string;
  abs: string;
  mtimeMs: number;
  size: number;
}

/** 工作区扫描（不截断）：按 mtime 降序的**全量候选**。
 *  与 `scanSourceFiles` 分开是有意的——被帽挤掉的那些文件也得数得出来（第几位、一共几个候选），
 *  否则「图里没有它」永远只能猜成因。帽的切片只在 `applyFileCap` 一处发生。 */
export async function scanSourceFilesAll(workspace: string): Promise<ScannedFile[]> {
  const args = [
    "--files",
    "--hidden",
    ...NOISE_GLOBS.flatMap((g) => ["--glob", "!" + g]),
    workspace,
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(rgBinary(), args, { cwd: workspace, env: sanitizedEnv() }); // D1：env 消毒
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (out += "")); // stderr 只影响退出码路径
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) reject(new Error(`map: rg 退出码 ${String(code)}`));
      else resolve(out);
    });
  });
  const rels = stdout
    .split("\n")
    .filter(Boolean)
    .map((p) => relative(resolve(workspace), resolve(p)).split(sep).join("/")) // rg 给绝对路径 → workspace 相对（glob 同口径）
    .filter((rel) => {
      const ext = rel.includes(".") ? rel.slice(rel.lastIndexOf(".") + 1).toLowerCase() : "";
      return SUPPORTED_EXTS.includes(ext);
    });
  const out: ScannedFile[] = [];
  for (const rel of rels) {
    const abs = join(workspace, rel);
    try {
      const st = await stat(abs);
      if (st.isFile()) out.push({ rel, abs, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // stat 失败的文件跳过（ races / 坏链接）
    }
  }
  out.sort(compareCandidates);
  return out;
}

/** 候选次序（唯一判据）：**mtime 新→旧，同秒按 workspace 相对路径字典序**。
 *  第二级不是装饰：`git worktree add`／`git checkout` 出来的树里所有文件共用一个秒，
 *  只按 mtime 排 ⇒ 谁进图由 `rg` 的目录遍历顺序决定，同一份代码在两台机器上给出两张图。
 *  本机实测（2026-09-30，`/tmp/rgorder` 九个同 mtime 的 .ts）rg 的原始顺序是
 *  `y a e d x c z b m`——**不是**字典序 ⇒ 摘掉第二级是可观察的突变（有判卷与锚点）。 */
export function compareCandidates(a: ScannedFile, b: ScannedFile): number {
  return (b.mtimeMs - a.mtimeMs) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
}

/** 帽只在这一处发生（"取最近 N 个"这条政策不许有第二份实现）。 */
export function applyFileCap(files: ScannedFile[], maxFiles: number): ScannedFile[] {
  return files.slice(0, maxFiles);
}

/** 工作区扫描：全量候选（`scanSourceFilesAll`）→ 文件数帽（`applyFileCap`）。 */
export async function scanSourceFiles(workspace: string, maxFiles = MAX_FILES_DEFAULT): Promise<ScannedFile[]> {
  return applyFileCap(await scanSourceFilesAll(workspace), maxFiles);
}

// ---- tags 磁盘缓存（应用数据目录）----
export function defaultTagsCacheDir(): string {
  return process.env.M2B_TAGS_DIR ?? join(homedir(), ".m0-agent-loop", "symbol-map-tags");
}

function cacheFileFor(dir: string, abs: string): string {
  const key = createHash("sha1").update(abs).digest("hex");
  return join(dir, key + ".json");
}

async function readTagsCache(dir: string, f: ScannedFile): Promise<SymbolTag[] | null> {
  try {
    const raw = await readFile(cacheFileFor(dir, f.abs), "utf8");
    const e = JSON.parse(raw) as TagsCacheEntry;
    if (e.v !== TAGS_EXTRACT_VERSION) return null; // 抽取判据换过 → 旧 tags 一律作废（缺 v 字段同此支）
    if (e.mtimeMs === f.mtimeMs && e.size === f.size && Array.isArray(e.tags)) return e.tags;
    return null; // {mtime,size} 指纹变化 → miss
  } catch {
    return null; // 无缓存/缓存损坏 → miss（损坏条目下次被覆写，不抛）
  }
}

async function writeTagsCache(dir: string, f: ScannedFile, tags: SymbolTag[]): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const entry: TagsCacheEntry = { v: TAGS_EXTRACT_VERSION, mtimeMs: f.mtimeMs, size: f.size, tags };
    await writeFile(cacheFileFor(dir, f.abs), JSON.stringify(entry), "utf8");
  } catch (err) {
    console.debug("[map] tags 缓存写失败（忽略）:", err instanceof Error ? err.message : String(err));
  }
}

// ---- 渲染内存缓存（指纹不变复用；每 N 轮重算）----
interface RenderCacheEntry {
  fingerprint: string;
  text: string;
  tokens: number;
  included: number;
  round: number;
}

export interface BuildMapOptions {
  workspace: string;
  /** 对话提到的标识符（×10）。 */
  mentionedIdents?: string[];
  /** 上下文文件（workspace 相对；×50 + personalization）。 */
  contextFiles?: string[];
  /** 预算 token（归一后夹 [1024, 4096]）。 */
  budgetTokens?: number;
  /** 模型输入上限（预算上限 = /8）。 */
  maxInputTokens?: number;
  /** tags 缓存目录（缺省应用数据目录）。 */
  tagsCacheDir?: string;
  /** 文件数帽（缺省 400，mtime 优先）。 */
  maxFiles?: number;
  /** 当前注入轮次（配合 recomputeEvery 做每 N 轮重算）。 */
  nowRound?: number;
  /** 每 N 轮强制重算（缺省 10）。 */
  recomputeEvery?: number;
}

export interface MapBuildResult {
  /** 地图正文（空串 = 无地图/降级）。 */
  text: string;
  tokens: number;
  /** false = 内部异常走了降级（文本必为空）。 */
  ok: boolean;
  /** tags 缓存命中文件数 / 实际解析文件数。 */
  fromTagsCache: number;
  parsed: number;
  /** 渲染内存缓存命中（指纹未变）。 */
  fromRenderCache: boolean;
  fingerprint: string;
  /** 帽（实发值）／进图文件数／帽前候选数 —— 注入面靠这三个数说同一句覆盖面自述。
   *  为什么带出来而不是在注入侧再算：`applyFileCap` 只在这一处切 ⇒ 分母也只能在这一处取；
   *  注入侧自己再扫一遍就是第二份取料面（会跟这张图不一致，规则 261 同族）。 */
  cap: number;
  graphFiles: number;
  candidates: number;
  /** 降级原因（ok=false 时有值）。09-30 起**会**进上下文（一句有界说明，见 `mapInjectText`）——
   *  从前它只走 `console.debug`，模型读到的是"没有地图"，与"这仓库没结构"同形。 */
  error?: string;
}

/** 降级那一句说明（模型可见）。原因来自异常消息 ⇒ 截 200 字：那是别人的文本，不是我们承诺的长度。 */
export function mapUnavailableText(why: string): string {
  return `[map] 仓库地图本次不可用（原因：${why.slice(0, 200)}）⇒ 这**不代表仓库没有结构**，也不要当成"没有依赖关系"；` +
    "请改用 glob/grep/read_file 定位，必要时稍后重试";
}

/** 把一次构建结果收成**注入给模型的文本**（`null` = 这一轮什么都不加）。
 *  三态不许同形（规则 261）：
 *  ⑴ `ok:false`（grammar/环境级失败、内部异常）⇒ 必须出声，并说清"这不是仓库没有结构"；
 *  ⑵ 正常但图非全量 ⇒ 复用 `impact/coverage.ts` 那把尺的同一句话（地图与影响面共用一个判据）；
 *  ⑶ 正常且收全 ⇒ 正文逐字不变（零回归哨兵，另有判卷钉着）。 */
export function mapInjectText(built: MapBuildResult): string | null {
  if (!built.ok) return mapUnavailableText(built.error ?? "未记原因");
  if (built.text === "") return null;
  return built.text + coverageNote(built.graphFiles, built.cap, built.candidates);
}

/** 上下文文件签名：文件集 {rel,mtime,size} + mentioned_idents + context_files + 预算 → sha1。
 *  E6（审查 P2）：contextFiles 影响边权（×50）与 personalization——不入指纹则指纹不变时
 *  复用陈旧地图（最长滞后 recomputeEvery 轮）。 */
export function mapFingerprint(
  files: ScannedFile[],
  mentionedIdents: string[] | undefined,
  budget: number,
  contextFiles?: string[],
): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        f: files.map((x) => [x.rel, Math.round(x.mtimeMs), x.size]),
        m: [...(mentionedIdents ?? [])].sort(),
        c: [...(contextFiles ?? [])].sort(),
        b: budget,
      }),
    )
    .digest("hex");
}

/**
 * 一次地图构建。实例级渲染缓存由 createMapBuilder 持有；本便捷函数 = 每次全新缓存。
 * 全函数体 try/catch：任何异常 → ok:false + 空地图（调用方退回纯 agentic 探索）。
 */
export async function buildMap(opts: BuildMapOptions): Promise<MapBuildResult> {
  return createMapBuilder(opts).build(opts);
}

export interface MapBuilder {
  build(opts: BuildMapOptions): Promise<MapBuildResult>;
}

/** 带（指纹 → 渲染）内存缓存的构建器：同一实例跨轮复用。 */
export function createMapBuilder(defaults: Partial<BuildMapOptions> = {}): MapBuilder {
  const cache = new Map<string, RenderCacheEntry>(); // workspace → entry
  return {
    async build(opts: BuildMapOptions): Promise<MapBuildResult> {
      const merged: BuildMapOptions = { ...defaults, ...opts };
      try {
        const budget = clampBudget(merged.budgetTokens, merged.maxInputTokens);
        // 帽在这一处解析、切片只在 `applyFileCap` 一处发生；**帽前全量候选**要留着当自述的分母
        // （从前这里走 `scanSourceFiles`，那函数内部就切了 ⇒ 地图这一侧数不出"漏了几个"，只能闭嘴）。
        const cap = merged.maxFiles ?? MAX_FILES_DEFAULT;
        const candidates = await scanSourceFilesAll(merged.workspace);
        const files = applyFileCap(candidates, cap);
        const fingerprint = mapFingerprint(files, merged.mentionedIdents, budget, merged.contextFiles);
        const cached = cache.get(merged.workspace);
        const round = merged.nowRound ?? 0;
        const every = merged.recomputeEvery ?? RECOMPUTE_EVERY_DEFAULT;
        if (cached && cached.fingerprint === fingerprint && cached.text !== "" && round - cached.round < every) {
          return {
            text: cached.text,
            tokens: cached.tokens,
            ok: true,
            fromTagsCache: 0,
            parsed: 0,
            fromRenderCache: true,
            fingerprint,
            cap,
            graphFiles: files.length,
            candidates: candidates.length,
          };
        }

        // tags：缓存命中直接用，未命中解析并写缓存。
        // E8（审查 P2）：readFile 走顶层导入（旧实现循环内每次动态 import），源码读取并行（纯 I/O）；
        // 解析保持串行——tree-sitter WASM 初始化/解析共享环境，并发 parse 实测互相干扰（丢 tags）。
        // E7（审查 P2）：单文件读/解析失败只降级该文件；grammar 环境级失败（TreeSitterUnavailable）
        // 上抛 → 整图降级（锚定契约：ok:false 静默降级不抛出）。
        const dir = merged.tagsCacheDir ?? defaultTagsCacheDir();
        const inputs: FileTagsInput[] = [];
        let hits = 0;
        const misses: ScannedFile[] = [];
        for (const f of files) {
          const hit = await readTagsCache(dir, f);
          if (hit) {
            hits++;
            inputs.push({ file: f.rel, tags: hit });
          } else {
            misses.push(f);
          }
        }
        const sources = await Promise.all(
          misses.map(async (f): Promise<{ f: ScannedFile; src: string } | null> => {
            try {
              return { f, src: await readFile(f.abs, "utf8") };
            } catch (err) {
              console.debug(`[map] 单文件读取失败（跳过）: ${f.rel}`, err instanceof Error ? err.message : String(err));
              return null;
            }
          }),
        );
        const cacheWrites: Promise<void>[] = []; // 竞态修复：写缓存曾为即发即忘 → 第二次构建必然 miss
        for (const s of sources) {
          if (s === null) continue;
          try {
            const ext = s.f.rel.slice(s.f.rel.lastIndexOf(".") + 1).toLowerCase();
            const tags = await fileTags(s.src, ext);
            inputs.push({ file: s.f.rel, tags });
            cacheWrites.push(writeTagsCache(dir, s.f, tags).catch(() => {})); // 竞态修复：收集，返回前统一 await（见循环后）
          } catch (err) {
            if (err instanceof TreeSitterUnavailableError) throw err; // 环境级：整图降级
            console.debug(`[map] 单文件解析失败（跳过）: ${s.f.rel}`, err instanceof Error ? err.message : String(err));
          }
        }

        await Promise.allSettled(cacheWrites); // 竞态修复：确保落盘再返回，否则下一轮 readTagsCache 必然 miss
        const graph = buildGraph(inputs, {
          mentionedIdents: merged.mentionedIdents,
          contextFiles: merged.contextFiles,
        });
        const ranks = personalizedPageRank(graph);
        const rendered = renderMapBudget(graph, ranks, budget);
        cache.set(merged.workspace, {
          fingerprint,
          text: rendered.text,
          tokens: rendered.tokens,
          included: rendered.included,
          round,
        });
        return {
          text: rendered.text,
          tokens: rendered.tokens,
          ok: true,
          fromTagsCache: hits,
          parsed: files.length - hits,
          fromRenderCache: false,
          fingerprint,
          cap,
          graphFiles: files.length,
          candidates: candidates.length,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.debug("[map] 构建失败，静默降级为无地图:", msg);
        // 降级面上的三个数取"什么都不知道"那一档：图是空的 ⇒ 自述由 `mapInjectText` 的 ok:false 分支出声，
        // 不走覆盖面那句（拿 0/0 去说"另有 0 个没进图"会把失败读成"收全了"）。
        return {
          text: "", tokens: 0, ok: false, fromTagsCache: 0, parsed: 0, fromRenderCache: false, fingerprint: "",
          cap: merged.maxFiles ?? MAX_FILES_DEFAULT, graphFiles: 0, candidates: 0, error: msg,
        };
      }
    },
  };
}
