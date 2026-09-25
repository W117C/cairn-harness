// 测试可达图（纯函数库，供 `outputs/untested-core-2026-09-26/01-reach.mts` 与
// `tests/src-execution-path.test.ts` **共用同一把尺**——判据各抄一份迟早漂，这里只留一份）。
//
// 为什么要区分两类边：vitest 运行时会把 `import type` 整个擦掉，
// 所以"有个测试引了这个文件"可能一行都没执行——那叫**假覆盖**，比没人引更坏（读的人以为有尺）。
// 于是两条闭包：`live`（只走值边，含 `await import()` / `require()`）与 `all`（含类型边）。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const TYPE_ONLY = /^\s*(?:import|export)\s+type\s/;

export interface Edges { value: string[]; type: string[] }
export interface Graph { files: string[]; edges: Map<string, Edges> }

/** 把一条相对 spec 归一到图内的 `.ts`（`.js` 后缀是本仓 ESM 写法，指向同名 `.ts`）。 */
export function resolveSpec(fromFile: string, spec: string, root: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // 依赖包不在本图里
  if (/\.(mjs|json)$/.test(spec)) return null;
  const abs = resolve(root, dirname(fromFile), spec);
  const cand = [abs + ".ts", abs, abs.replace(/\.js$/, ".ts"), join(abs, "index.ts")];
  const hit = cand.find((c) => existsSync(c) && /\.(ts|mts)$/.test(c));
  return hit === undefined ? null : relative(root, hit).split("\\").join("/");
}

export function edgesOf(file: string, root: string): Edges {
  const text = readFileSync(join(root, file), "utf8");
  const value: string[] = [];
  const type: string[] = [];
  const add = (spec: string, stmt: string): void => {
    const target = resolveSpec(file, spec, root);
    if (target === null) return;
    (TYPE_ONLY.test(stmt) ? type : value).push(target);
  };
  // 静态 `import|export … from "…"`（[\s\S]{0,400}? 覆盖跨行的多命名导入）
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(import|export)\b([\s\S]{0,400}?)from[ \t]*"((?:\.[^"]|\/)[^"]*)"/g)) add(m[3]!, m[0]!);
  for (const m of text.matchAll(/(?:await\s+)?import\(\s*"((?:\.[^"]|\/)[^"]*)"\s*\)/g)) add(m[1]!, "import");
  for (const m of text.matchAll(/require\(\s*"((?:\.[^"]|\/)[^"]*)"\s*\)/g)) add(m[1]!, "import");
  return { value, type };
}

function walk(dir: string, root: string, out: string[]): void {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (/\.ts$|\.mts$/.test(e.name) && !p.endsWith(".d.ts")) out.push(p.split("\\").join("/"));
  }
}

export function buildGraph(root: string, dirs: string[]): Graph {
  const files: string[] = [];
  for (const d of dirs) if (existsSync(join(root, d))) walk(d, root, files);
  const uniq = [...new Set(files)];
  const edges = new Map<string, Edges>();
  for (const f of uniq) edges.set(f, edgesOf(f, root));
  return { files: uniq, edges };
}

/** BFS 可达集，带 parent 表（`--why` 用它打印一条真实路径）。 */
export function closure(roots: string[], g: Graph, useTypeEdges: boolean): { seen: Set<string>; parent: Map<string, string> } {
  const seen = new Set<string>(roots);
  const parent = new Map<string, string>();
  const q = [...roots];
  while (q.length > 0) {
    const cur = q.shift()!;
    const e = g.edges.get(cur);
    if (e === undefined) continue;
    for (const next of useTypeEdges ? [...e.value, ...e.type] : e.value) {
      if (seen.has(next)) continue;
      seen.add(next); parent.set(next, cur); q.push(next);
    }
  }
  return { seen, parent };
}

export interface Reach {
  root: string;
  src: string[];
  tests: string[];
  scripts: string[];
  /** 测试文件 → 它 `vi.mock` 掉的 src 模块（判卷面与读数都要能列出这个） */
  mocks: Map<string, string[]>;
  all: Set<string>;
  /** 不扣 mock 的旧口径，留着量"mock 到底改变了多少"（口径换了要能对照） */
  naiveLive: Set<string>;
  /** 真会执行的集合：逐测试求可达（跳过被 mock 的整棵下游）再取并集 */
  live: Set<string>;
  /** 每个 src 模块的**第一条**真实执行路径（起点是某个测试文件）；`--why` 与失败信息用它 */
  paths: Map<string, string[]>;
  gate: Set<string>;
  g: Graph;
}

/** 一个测试文件里 `vi.mock("<…src…>")` 指到的模块。
 *  为什么单独算：`vi.mock` 会把该模块换成桩，**真实实现一行都不执行**——
 *  只被 mock 边连到的模块，在"有没有人跑过它"这个问题上是**没跑过**。 */
export function mockedTargets(file: string, root: string): Set<string> {
  let text = "";
  try { text = readFileSync(join(root, file), "utf8"); } catch { return new Set(); }
  const out = new Set<string>();
  for (const m of text.matchAll(/vi\.mock\(\s*["']((?:\.[^'"]|\/)[^'"]*)["']/g)) {
    const p = resolveSpec(file, m[1]!, root);
    if (p !== null) out.add(p);
  }
  return out;
}

/** 从单个测试根出发的**真实执行**可达集：跳过被 `vi.mock` 的模块及其整棵下游
 *  （被 mock 的模块不执行，它自己 import 的东西在这个测试里同样不执行）。 */
function reachableFromTest(t: string, g: Graph, root: string): { seen: Set<string>; parent: Map<string, string> } {
  const direct = mockedTargets(t, root);
  const blocked = direct.size === 0 ? new Set<string>() : closure([...direct], g, true).seen;
  const seen = new Set<string>([t]);
  const parent = new Map<string, string>();
  const q = [t];
  while (q.length > 0) {
    const cur = q.shift()!;
    for (const next of g.edges.get(cur)?.value ?? []) {
      if (seen.has(next) || blocked.has(next)) continue;
      seen.add(next); parent.set(next, cur); q.push(next);
    }
  }
  return { seen, parent };
}

export function analyze(root: string): Reach {
  const g = buildGraph(root, ["src", "tests", "scripts"]);
  const src = g.files.filter((f) => f.startsWith("src/"));
  const tests = g.files.filter((f) => f.startsWith("tests/") && f.endsWith(".test.ts"));
  const scripts = g.files.filter((f) => f.startsWith("scripts/"));
  const live = new Set<string>();
  const mocks = new Map<string, string[]>();
  const paths = new Map<string, string[]>(); // 第一条真实执行路径（给 --why 用）
  for (const t of tests) {
    const d = [...mockedTargets(t, root)];
    if (d.length > 0) mocks.set(t, d);
    const { seen, parent } = reachableFromTest(t, g, root);
    for (const f of seen) {
      if (!f.startsWith("src/")) continue;
      live.add(f);
      if (!paths.has(f)) {
        const chain: string[] = [];
        let cur: string | undefined = f;
        while (cur !== undefined) { chain.unshift(cur); cur = parent.get(cur); }
        if (chain[0] === t) paths.set(f, chain);
      }
    }
  }
  return {
    root, src, tests, scripts, mocks, paths, g,
    all: closure(tests, g, true).seen,          // 含类型边：只看"有没有人引"，用来标假覆盖
    naiveLive: closure(tests, g, false).seen,   // 不扣 mock 的旧口径，留着量"mock 到底改变了多少"
    live,
    gate: closure(scripts, g, false).seen,      // 门脚本：跑门时真执行，但不算判卷面
  };
}

/** 一条从某个测试到 target 的**真实执行**路径（该测试没把它 mock 掉）；找不到返回 null。 */
export function valuePath(r: Reach, target: string): string[] | null {
  return r.paths.get(target) ?? null;
}
