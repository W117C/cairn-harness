// 符号图**召回率**探针（与 precision 那轮对偶：假边已经量过，漏抽从没量过）。
// 为什么要有：`impact_query` 对没抽到的符号会说「这张图里没有」，而「图里没有」与「图漏了」
// 在回执里同形 ⇒ 召回缺口是**静默**的，比假边更难发现。
// 尺子必须独立于被测面：抽取走 `map/parse.ts` 的 tree-sitter `.scm` 图案，这里改走 TypeScript
// 自己的 AST（devDep 已有），只数**模块作用域的具名声明**（function / class / interface / type /
// enum / 带初值的 const|let）——口径与 precision 那轮一致：局部量与属性引用都不算，那两类是
// 09-23 主动收掉的假边来源，不是这里要追的召回。
//
// 首跑读数（本仓 405 个 .ts）：召回 0.9863、**4 个合法文件整文件零抽取**
// （`src/agent/map/parse.ts` / `scripts/ipc-reachability-check-core.ts` / `tests/secrets.test.ts` /
// `tests/sessions.test.ts`）。四个的共性是 grammar 误报（`import("pkg").T`、嵌套泛型实参、含 `//`
// 的正则字面量），而旧 `fileTags` 对 `hasError` 一票否决整文件。改成部分回收后：
// 召回 0.9991、零抽取 0 个。`map-check` ⑦ 现在把「零抽取 == 0」当机制不变量守住（阈值不守：
// 召回率会随新语言/新语法自然浮动，而「合法文件不该从图里整个消失」不会）。
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";
import { fileTags, TreeSitterUnavailableError } from "../src/agent/map/parse";

const SKIP_SEGS = new Set(["node_modules", ".git", "out", "dist", ".agent", ".codegraph", ".worktrees", ".qoder", ".workbuddy", ".tmp"]);

async function walkTs(root: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const childRel = rel === "" ? e.name : rel + "/" + e.name;
    if (e.isDirectory()) {
      if (!SKIP_SEGS.has(e.name)) await walkTs(root, childRel, out);
    } else if (e.isFile() && e.name.endsWith(".ts")) out.push(childRel);
  }
}

/** 地面真值：TS AST 里模块作用域的具名声明。`export function f(){}` 仍是 FunctionDeclaration
 *  （export 只是 modifier），所以直接按语句形状取名字即可，不必再判 modifier。 */
export function astModuleNames(text: string, path: string): Set<string> {
  const src = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  for (const stmt of src.statements) {
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)
      || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      if (stmt.name) names.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer !== undefined) names.add(d.name.text);
      }
    }
  }
  return names;
}

// 自检（每次跑都注入，不只第一次）：读数为 0 有四种完全不同的成因（grammar 装不上 /
// 后缀写法不对 / 抽取真的全漏 / 目录没扫到文件），而它们在同一行输出里长得一模一样。
// `fileTags(src, ext)` 的 ext 是**不带点**的键（`LANG_BY_EXT` 是 `ts`/`tsx`…），
// 传 `.ts` 会走「不认识的后缀 ⇒ 空 tags」那一支，静默量出召回 0——本探针第一次就是这么"红"的。
async function selfCheck(): Promise<void> {
  const tags = await fileTags("export function __dsh_probe_self__(): void {}\n", "ts");
  if (!tags.some((t) => t.kind === "def" && t.name === "__dsh_probe_self__")) {
    throw new Error(`自检失败：抽取面给了 ${String(tags.length)} 个 tags，却没有那个必然存在的定义 ⇒ 召回读数不可信`);
  }
}

export interface RecallReport {
  tsFiles: number;
  scanned: number;
  decls: number;
  caught: number;
  /** 图里一个定义都没有的文件（这些文件对 impact 而言是隐身的）。 */
  zeroDefFiles: Array<[string, number]>;
  /** 漏抽的名字 → 出现次数。 */
  misses: Map<string, number>;
}

/** 全仓召回测量。grammar 装不上时抛 `TreeSitterUnavailableError`（调用方判「未证」，不判 0）。 */
export async function measureMapRecall(root: string): Promise<RecallReport> {
  const files: string[] = [];
  await walkTs(root, "", files);
  files.sort();
  await selfCheck();
  let decls = 0;
  let caught = 0;
  let scanned = 0;
  const misses = new Map<string, number>();
  const zeroDefFiles: Array<[string, number]> = [];
  for (const rel of files) {
    const text = await readFile(join(root, rel), "utf8");
    const want = astModuleNames(text, rel);
    if (want.size === 0) continue;
    scanned++;
    const got = new Set((await fileTags(text, "ts")).filter((t) => t.kind === "def").map((t) => t.name));
    // 「整文件零抽取」与「漏了几个名字」是两种病：前者多半是 grammar 误报（`fileTags` 的
    // 回收支只丢 ERROR 子树），整文件都不该消失。
    if (got.size === 0) zeroDefFiles.push([rel, want.size]);
    for (const n of want) {
      if (got.has(n)) caught++;
      else misses.set(n, (misses.get(n) ?? 0) + 1);
    }
    decls += want.size;
  }
  return { tsFiles: files.length, scanned, decls, caught, zeroDefFiles, misses };
}

/** 零抽取文件的第一个 ERROR 现场（真坏了 vs grammar 误报）。自己起一份 tree-sitter，
 *  与 `parse.ts` 同款的运行时解析路径（打包后 `require.resolve` 会落空）。 */
export async function firstErrorSites(root: string, rels: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  try {
    const nodeRequire = createRequire(import.meta.url);
    const w = await import("web-tree-sitter");
    await (w.Parser as unknown as { init: (a: { locateFile: (f: string) => string }) => Promise<void> })
      .init({ locateFile: (f: string) => nodeRequire.resolve("web-tree-sitter/" + f) });
    const parser = new w.Parser();
    parser.setLanguage(await w.Language.load(nodeRequire.resolve("tree-sitter-wasms/out/tree-sitter-typescript.wasm")) as never);
    for (const rel of rels) {
      const src = await readFile(join(root, rel), "utf8");
      const tree = parser.parse(src);
      if (tree === null) { out.push(rel + "：parse 返回 null（连树都没有）"); continue; }
      let first: { type: string; idx: number } | null = null;
      const walkNode = (n: import("web-tree-sitter").Node): void => {
        if (first !== null) return;
        if (n.type === "ERROR" || n.isMissing) { first = { type: n.type, idx: n.startIndex }; return; }
        for (const c of n.children) { if (c !== null) walkNode(c); }
      };
      walkNode(tree.rootNode);
      const at = first as { type: string; idx: number } | null;
      if (at === null) { out.push(`${rel}：hasError=${String(tree.rootNode.hasError)} 但找不到 ERROR 节点（这条读数本身要再查）`); continue; }
      const line = src.slice(0, at.idx).split("\n").length;
      out.push(`${rel}:${String(line)} 首个 ${at.type} 现场：${JSON.stringify(src.slice(at.idx, at.idx + 70))}`);
    }
  } catch (err) {
    out.push("ERROR 定位跳过：" + (err instanceof Error ? err.message : String(err)));
  }
  return out;
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("probe-map-recall.ts");
if (invokedDirectly) {
  const ROOT = resolve(import.meta.dirname, "..");
  try {
    const r = await measureMapRecall(ROOT);
    const rate = r.decls === 0 ? 0 : r.caught / r.decls;
    console.log(`[map-recall] .ts 文件 ${String(r.tsFiles)}（有模块级声明的 ${String(r.scanned)}）· 声明 ${String(r.decls)} · 图里有定义 ${String(r.caught)} · 召回 ${rate.toFixed(4)}`);
    const top = [...r.misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.log(`[map-recall] 漏抽名字 ${String(r.misses.size)} 个；前 ${String(top.length)}：` + top.map(([n, c]) => `${n}×${String(c)}`).join("、"));
    console.log(`[map-recall] 漏集指纹 ${createHash("sha1").update([...r.misses.keys()].sort().join("\n")).digest("hex").slice(0, 12)}`);
    console.log(`[map-recall] 整文件零抽取：${String(r.zeroDefFiles.length)} 个（这些文件在图里完全不存在，impact 只会回「没找到」）`);
    for (const [rel, n] of r.zeroDefFiles.slice(0, 20)) console.log(`  · ${rel}（AST 里有 ${String(n)} 个模块级声明）`);
    if (r.zeroDefFiles.length > 0) {
      for (const line of await firstErrorSites(ROOT, r.zeroDefFiles.slice(0, 6).map(([rel]) => rel))) console.log("    · " + line);
    }
  } catch (err) {
    if (err instanceof TreeSitterUnavailableError) {
      console.log("[map-recall] 未证：tree-sitter 装不上 ⇒ 召回率量不了（不拿「一个都没抽到」冒充召回 0）：" + err.message);
      process.exitCode = 2;
    } else throw err;
  }
}
