// v11 主界面批：项目内文件模糊搜索（@ 引用补全的数据面）。
// core 层、electron-free。口径：
//   · 子序列匹配（大小写不敏感）：词首/连续命中加分，basename 全含/前缀另加分——"index" 先给你 index.ts 而不是路径里恰好含 i-n-d-e-x 的长路径；
//   · 跳过 .git/node_modules 等（点目录一律跳过——.agent 快照不进 @ 引用面）；
//   · 扫描 2 万条帽 + 命中 50 帽 + 深度 12 帽，超帽 truncated=true（永远不假装完整）。
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface SearchHit {
  /** workspace 相对路径（正斜杠）。 */
  path: string;
  kind: "file" | "directory";
}

export type WorkspaceSearchPayload =
  | { ok: true; hits: SearchHit[]; truncated: boolean }
  | { ok: false; error: string };

/** 大目录/构建产物跳过（点目录一律跳过，另见 walk）。 */
const SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist", "dist-electron", "build", ".next", "out", "release"]);
export const MAX_SCAN_ENTRIES = 20_000;
export const MAX_RESULTS = 50;
export const MAX_DEPTH = 12;

/** 子序列匹配打分：query 字符按序出现即命中（大小写不敏感）；空查询/缺字 = null。
 *  词首（前字符是 / . - _ 或串首）+3；连续命中 +2；每次命中 +1。 */
export function fuzzyMatch(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q === "") return null;
  let qi = 0;
  let score = 0;
  let lastHit = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] !== q[qi]) continue;
    score += 1;
    if (ti === lastHit + 1) score += 2;
    const prev = ti === 0 ? "/" : t[ti - 1]!;
    if (prev === "/" || prev === "." || prev === "-" || prev === "_") score += 3;
    lastHit = ti;
    qi += 1;
  }
  return qi === q.length ? score : null;
}

function basenameOf(p: string): string {
  const at = p.lastIndexOf("/");
  return at < 0 ? p : p.slice(at + 1);
}

/** 候选路径排序：分降序 → 路径短优先 → 字典序。空查询 = 空结果（不做全量倾倒）。 */
export function rankHits(query: string, paths: readonly string[]): { path: string; score: number }[] {
  const q = query.trim();
  if (q === "") return [];
  const ql = q.toLowerCase();
  const out: { path: string; score: number }[] = [];
  for (const path of paths) {
    const base = fuzzyMatch(q, path);
    if (base === null) continue;
    let score = base;
    const name = basenameOf(path).toLowerCase();
    if (name.includes(ql)) score += 8;
    if (name.startsWith(ql)) score += 4;
    out.push({ path, score });
  }
  out.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return out;
}

/** 递归搜索：目录树一层一层走（深度/条目双帽），命中集交 rankHits 排序后截到 MAX_RESULTS。 */
export async function searchWorkspace(workspace: string, rawQuery: string): Promise<WorkspaceSearchPayload> {
  const st = await stat(workspace).catch(() => null);
  if (st === null || !st.isDirectory()) return { ok: false, error: `目录不存在或不是目录：${workspace}` };
  const query = rawQuery.trim();
  if (query === "") return { ok: true, hits: [], truncated: false };

  const dirs = new Set<string>();
  const paths: string[] = [];
  let scanned = 0;
  let scanTruncated = false;
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (scanTruncated || depth > MAX_DEPTH) return;
    const entries = await readdir(join(workspace, rel), { withFileTypes: true }).catch(() => null);
    if (entries === null) return;
    for (const e of entries) {
      if (scanned >= MAX_SCAN_ENTRIES) { scanTruncated = true; return; }
      const name = e.name;
      const childRel = rel === "" ? name : `${rel}/${name}`;
      if (e.isDirectory()) {
        if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
        scanned += 1;
        paths.push(childRel);
        dirs.add(childRel);
        await walk(childRel, depth + 1);
      } else if (e.isFile()) {
        scanned += 1;
        paths.push(childRel);
      }
    }
  };
  await walk("", 1);

  const ranked = rankHits(query, paths);
  const hits = ranked.slice(0, MAX_RESULTS).map((r) => ({
    path: r.path,
    kind: dirs.has(r.path) ? ("directory" as const) : ("file" as const),
  }));
  return { ok: true, hits, truncated: scanTruncated || ranked.length > MAX_RESULTS };
}
