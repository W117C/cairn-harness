// 影响面索引持久化层：把 buildImpact 的图落成带版本的 artifact，同 git 提交＋全量文件
// 指纹命中 ⇒ 直接载入（零解析）；任一文件变化 ⇒ 上层退回 tags 缓存增量、建完覆写 artifact。
// artifact 只写应用数据目录（cacheDir 的兄弟目录 impact-index），绝不写进用户仓库。
// 键取 `<sha>-<wshash>.json` 而不是裸 `<sha>.json`：同一台机器上主仓、fixtures 夹具、tmp
// 测试仓可能共用同一个 git sha，裸 sha 键会让几张不同的图互相覆写踢掉对方。
// 载入判据里任何一格不符（版本/sha/文件集/逐文件指纹/JSON 损坏）一律按 miss 返回 null
// 由上层照常重建并覆写——损坏自愈，绝不抛（建图是护栏的进料，进料不能被缓存炸掉）。
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ScannedFile } from "../map/build.js";
import type { AttributionStats } from "./attribution.js";
import type { ImpactEdge, ImpactGraph, ImpactSite } from "./index.js";

const execFileP = promisify(execFile);

/** artifact 格式版本：载入时对不上就按 miss 重建（含旧条目没有此字段的情况）。
 *  1→2（任务 #9）：多了归属取料面 `nameSources` 与三态计数 `attribution`。**整层作废**是有意的——
 *  只加字段而不升版本 ⇒ 老 artifact 载入后 `nameSources` 全缺，整张图读成"处处都没证据可判"，
 *  现象就是"波及面一夜之间退回按名字图"（与地图侧「缓存那一支不生效」同族）。 */
export const IMPACT_INDEX_SCHEMA_VERSION = 2;

export interface ImpactIndexFingerprint {
  rel: string;
  mtimeMs: number;
  size: number;
}

/** 落盘形状：Map 展开成按 symbol 排序的条目数组（JSON 没有有序 Map，且确定性可逐字 diff）。 */
export interface ImpactIndexArtifact {
  schemaVersion: number;
  commitSha: string;
  /** workspace 相对路径，排序。 */
  files: string[];
  candidates: number;
  cap: number;
  /** 与 tags 缓存同源的 {mtime,size} 指纹，按 rel 排序——两层判据同尺，
   *  不会出现「索引说新、tags 缓存说旧」的劈叉。 */
  fingerprints: ImpactIndexFingerprint[];
  defs: { symbol: string; sites: ImpactSite[] }[];
  refs: { symbol: string; sites: ImpactSite[] }[];
  edges: ImpactEdge[];
  /** 引用方文件 → 名字 → 绑定来源（`external:<说明符>` 前缀＝外部包）。
   *  与 tags 同批产出 ⇒ **同存同取**：少了它，从索引载入的那张图会把每个文件都读成
   *  "没有 import 面可判"，归属判据整层失效（现象＝波及面退回按名字图，且没有任何报错）。 */
  nameSources: ImpactNameSource[];
  /** 边构造的三态计数。原样带回——丢了它，读端说不出"排除了几处／几处没证据"。 */
  attribution: AttributionStats;
}

/** 落盘形状：Map → 按名排序的数组（JSON 没有有序 Map，且要能逐字 diff）。 */
export interface ImpactNameBinding {
  symbol: string;
  sources: string[];
}
export interface ImpactNameSource {
  file: string;
  bindings: ImpactNameBinding[];
}

/** 索引目录：cacheDir 的兄弟目录（生产 = ~/.m0-agent-loop/impact-tags → ~/.m0-agent-loop/impact-index，
 *  与既有 impact-tags 缓存同区；测试给 tmp cacheDir ⇒ 索引也落 tmp，不碰用户主目录）。 */
export function impactIndexDirFor(cacheDir: string): string {
  return join(dirname(cacheDir), "impact-index");
}

/** git rev-parse HEAD。非 git 仓/无提交/命令失败 → null：索引整层退回不参与
 *  （没有稳定键就不发明弱键），行为与没有索引层完全一致。 */
export async function currentCommitSha(workspace: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], {
      cwd: workspace,
      timeout: 10_000,
      windowsHide: true,
    });
    const sha = stdout.trim();
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function indexFileFor(indexDir: string, sha: string, wsAbs: string): string {
  // 键派生用 sha256：只是 workspace 绝对路径的缓存键，不是密码学用途，但没必要顶着弱算法告警。
  const wsKey = createHash("sha256").update(wsAbs).digest("hex").slice(0, 12);
  return join(indexDir, `${sha}-${wsKey}.json`);
}

/** 命中 ⇒ 直接可用的图（parsed/fromTagsCache=0、fromIndex=true）；任何不符 ⇒ null。 */
export async function loadImpactIndex(
  indexDir: string,
  wsAbs: string,
  sha: string,
  files: ScannedFile[],
): Promise<ImpactGraph | null> {
  try {
    const raw = await readFile(indexFileFor(indexDir, sha, wsAbs), "utf8");
    const a = JSON.parse(raw) as ImpactIndexArtifact;
    if (a === null || typeof a !== "object") return null;
    if (a.schemaVersion !== IMPACT_INDEX_SCHEMA_VERSION) return null;
    if (a.commitSha !== sha) return null;
    if (!Array.isArray(a.files) || !Array.isArray(a.fingerprints) || !Array.isArray(a.defs) ||
        !Array.isArray(a.refs) || !Array.isArray(a.edges) || !Array.isArray(a.nameSources)) {
      return null;
    }
    const at = a.attribution as AttributionStats | undefined;
    if (at === undefined || typeof at.kept !== "number" || typeof at.dropped !== "number" || typeof at.noEvidence !== "number") {
      return null; // 三态计数缺失 ⇒ 读端会说不出"排除了几处"，宁miss重建
    }
    // 全量文件指纹逐项核对（「同 sha＋全量文件 hash 命中」）：文件集同序比对，任一
    // rel/mtime/size 不符即 miss——文件被改过、增删过、换了帽都不许吃旧图。
    const current = [...files].sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
    if (a.files.length !== current.length || a.fingerprints.length !== current.length) return null;
    for (let i = 0; i < current.length; i++) {
      const fp = a.fingerprints[i];
      if (a.files[i] !== current[i].rel) return null;
      if (fp === null || typeof fp !== "object") return null;
      if (fp.rel !== current[i].rel) return null;
      if (fp.mtimeMs !== current[i].mtimeMs || fp.size !== current[i].size) return null;
    }
    const defs = new Map<string, ImpactSite[]>();
    for (const e of a.defs) defs.set(e.symbol, e.sites);
    const refs = new Map<string, ImpactSite[]>();
    for (const e of a.refs) refs.set(e.symbol, e.sites);
    const nameSources = new Map<string, Map<string, string[]>>();
    for (const ns of a.nameSources) {
      const m = new Map<string, string[]>();
      for (const b of ns.bindings) m.set(b.symbol, b.sources);
      nameSources.set(ns.file, m);
    }
    return {
      files: [...a.files],
      candidates: a.candidates,
      cap: a.cap,
      defs,
      refs,
      edges: a.edges,
      nameSources,
      attribution: { kept: at.kept, dropped: at.dropped, noEvidence: at.noEvidence },
      parsed: 0,
      fromTagsCache: 0,
      fromIndex: true,
    };
  } catch {
    return null; // 无索引 / JSON 损坏（含截断）/ 形状不对 → miss，上层照常重建并覆写
  }
}

/** 落盘。写失败静默（同 tags 缓存口径：缓存层故障不炸建图，下次退回全量重建）。 */
export async function saveImpactIndex(
  indexDir: string,
  wsAbs: string,
  sha: string,
  graph: ImpactGraph,
  files: ScannedFile[],
): Promise<void> {
  try {
    await mkdir(indexDir, { recursive: true });
    const artifact: ImpactIndexArtifact = {
      schemaVersion: IMPACT_INDEX_SCHEMA_VERSION,
      commitSha: sha,
      files: [...graph.files].sort(),
      candidates: graph.candidates,
      cap: graph.cap,
      fingerprints: files
        .map((f) => ({ rel: f.rel, mtimeMs: f.mtimeMs, size: f.size }))
        .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)),
      defs: [...graph.defs.entries()]
        .map(([symbol, sites]) => ({ symbol, sites }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
      refs: [...graph.refs.entries()]
        .map(([symbol, sites]) => ({ symbol, sites }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
      edges: graph.edges,
      nameSources: [...graph.nameSources.entries()]
        .map(([file, m]) => ({
          file,
          bindings: [...m.entries()]
            .map(([symbol, sources]) => ({ symbol, sources: [...sources].sort() }))
            .sort((a, b) => a.symbol.localeCompare(b.symbol)),
        }))
        .sort((a, b) => a.file.localeCompare(b.file)),
      attribution: { ...graph.attribution },
    };
    await writeFile(indexFileFor(indexDir, sha, wsAbs), JSON.stringify(artifact), "utf8");
  } catch (err) {
    console.debug(
      "[impact] 索引写失败（忽略，下次全量重建）:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
