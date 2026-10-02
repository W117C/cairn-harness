/** `scripts/head-import-face.ts` 的判卷（第 131 页立尺，第 135 页补符号那一半）。
 *  立尺的实测：`834ba3a` 把 4 个新模块留在未跟踪状态就提交了消费者 ⇒ HEAD 从那时起
 *  typecheck 8 条错、干净树 34 个判卷文件红，而**主树全量绿**——主树的判卷永远看不见这件事。
 *  本尺只看提交对象（`git ls-tree` ＋ `git cat-file --batch`），所以别人盘上的未提交改动盖不住它。
 *  判卷全部喂假表（存在性/正文注入）⇒ 不依赖真仓内容，除最后几条自证。 */
import { describe, expect, it } from "vitest";
import {
  HEAD_DANGLING_WAIVERS, HEAD_MISSING_SYMBOL_WAIVERS, checkHeadImportFace, checkMissingSymbols,
  blankDataSpans, clauseNames, collectHeadEdges, exportedNames, findDanglingImports, findMissingExports,
  parseBatchResponse, parseImportStatements, readHeadBlobs, resolveRelativeSpec, type HeadEdge,
} from "../scripts/head-import-face";

const FILES = new Set(["src/a.ts", "src/tools/run_shell.ts", "src/util/index.ts", "tests/a.test.ts"]);
const noDisk = (): boolean => false;
const allDisk = (): boolean => true;

/** 用真解析器造边（判卷不自己抄一份 clause 规则，否则尺和刀一起错也发现不了）。 */
const edgesOf = (from: string, text: string): HeadEdge[] =>
  parseImportStatements(text).map((s) => ({ from, spec: s.spec, names: s.clause.names }));

describe("resolveRelativeSpec：先要解析得对，才轮得到判悬空", () => {
  it("同目录、跨目录、带后缀三种写法都落到 HEAD 里那个文件", () => {
    expect(resolveRelativeSpec("src/a.ts", "./tools/run_shell", FILES)).toBe("src/tools/run_shell.ts");
    expect(resolveRelativeSpec("tests/a.test.ts", "../src/a", FILES)).toBe("src/a.ts");
    expect(resolveRelativeSpec("src/a.ts", "./tools/run_shell.ts", FILES)).toBe("src/tools/run_shell.ts");
  });

  it("`./x.js` 这种 ESM 写法指向的其实是 x.ts（第二版没做换后缀，凭空 40+ 条假红）", () => {
    expect(resolveRelativeSpec("src/a.ts", "./tools/run_shell.js", FILES)).toBe("src/tools/run_shell.ts");
  });

  it("目录形式落到 index.ts", () => {
    expect(resolveRelativeSpec("src/a.ts", "./util", FILES)).toBe("src/util/index.ts");
  });

  it("裸包名不是仓内边，一律不算（npm 包在 HEAD 文件表里本来就没有）", () => {
    expect(resolveRelativeSpec("src/a.ts", "vitest", FILES)).toBeNull();
    expect(resolveRelativeSpec("src/a.ts", "@electron/remote", FILES)).toBeNull();
  });
});

describe("parseImportStatements：取料单位是整条语句，不是行", () => {
  it("跨行的命名导入要抽出全部名字（第 131 页那条 SessionTransport 就是这个形状漏掉的）", () => {
    const text = 'import {\n  ALPHA,\n  type BETA,\n  GAMMA as DELTA,\n} from "./sibling";';
    const s = parseImportStatements(text);
    expect(s).toHaveLength(1);
    expect(s[0]?.spec).toBe("./sibling");
    expect(s[0]?.clause.names).toEqual(["ALPHA", "BETA", "GAMMA"]); // `as` 取源侧那个名字
    expect(s[0]?.clause.opaque).toBe(false);
  });

  it("假源码字符串不算边：`import` 前面既不是行首也不是 `;`", () => {
    const text = `const fake = 'import { ghost } from "./nope";';\nimport { real } from "./real";`;
    expect(parseImportStatements(text).map((s) => s.spec)).toEqual(["./real"]);
  });

  it("clause 不许跨过语句边界：出现 `(` `)` `=` `;` 就该停（实测：上一版把尺自己报成悬空）", () => {
    const text = 'export function resolveIt(spec: string): string {\n  // 注释里举例：from "./todo"\n  return spec;\n}\nimport { ok } from "./ok";';
    expect(parseImportStatements(text).map((s) => s.spec)).toEqual(["./ok"]);
    // 上面那条**对这条不变量零分辨力**（第 141 页普查实测：把 clause 的字符禁区摘掉，两种口径都只读出 `./ok`
    // ——注释在函数体里，非贪婪那一截根本不会走到它前面）。真正能分开的是"注释独立成行、夹在两条语句之间"：
    // 摘掉禁区 ⇒ 从上一行的 `}` 之后一路跨进来，多出一条不存在的边。
    const between = 'export function g(a: string): string {\n  const t = h(a);\n  return t;\n}\n// 说明文字 from "./doc"\nimport { ok } from "./ok";';
    expect(parseImportStatements(between).map((s) => s.spec)).toEqual(["./ok"]);
  });

  it("不带 from 的两种写法也是边（副作用与动态 import），但只判模块不点名", () => {
    // 两条 specifier 都指 HEAD 里**真的存在**的文件：本判卷自己也在取料面里，
    // 假路径写进 fixture 就等于给这把尺造一条真悬空（`./lazy` 实测在 HEAD 上造出 tests/lazy.ts 红）。
    const text = `import "../scripts/head-import-face";\nconst p = async (): Promise<unknown> => await import("../scripts/head-import-face");`;
    const s = parseImportStatements(text);
    expect(s.map((x) => x.spec)).toEqual(["../scripts/head-import-face", "../scripts/head-import-face"]);
    expect(s.every((x) => x.clause.names.length === 0)).toBe(true);
  });

  it("`export *`／`import * as ns` 不给名字，但模块边要留着（漏了边＝漏了悬空）", () => {
    const s = parseImportStatements('export * from "./a";\nexport * as ns from "./b";\nimport * as all from "./c";');
    expect(s.map((x) => x.spec)).toEqual(["./a", "./b", "./c"]);
    expect(s.every((x) => x.clause.names.length === 0 && x.clause.namespace)).toBe(true);
  });
});

describe("clauseNames：读不懂就整条不点名（宁少报，不假红）", () => {
  it("内联 `type` 修饰与 `as` 改名都要认（上一版 6 条假红全在这一族）", () => {
    expect(clauseNames("{ q, type R, s as t }").names).toEqual(["q", "R", "s"]);
    expect(clauseNames("{ q, type R, s as t }").opaque).toBe(false);
  });

  it("混合形状（默认导入 + 花括号）整条标 unreadable ⇒ 一个名字都不报", () => {
    const c = clauseNames("Foo, { bar }");
    expect(c.names).toEqual([]);
    expect(c.opaque).toBe(true);
  });
});

describe("exportedNames：目标那一版到底导出了什么", () => {
  it("声明式、`export {a, b as c}`、`export type {}` 三种都要收（漏一种＝把合法写法报成缺失）", () => {
    const text = [
      "export const A = 1;",
      "export interface I {}",
      "export type T = number;",
      "export function f() {}",
      "export { g, h as renamed };",
      'export type { Q } from "./x";',
    ].join("\n");
    const e = exportedNames(text);
    expect([...e.names].sort()).toEqual(["A", "I", "Q", "T", "f", "g", "renamed"]);
    expect(e.opaque).toBe(false);
  });

  it("`export * from` 把整面挡住 ⇒ opaque；`export * as ns` 只贡献一个名字，不算看不全", () => {
    expect(exportedNames('export * from "./a";').opaque).toBe(true);
    const one = exportedNames('export * as ns from "./a";');
    expect(one.opaque).toBe(false);
    expect(one.names.has("ns")).toBe(true);
  });
});

describe("findMissingExports：命名导入的名字必须在目标的导出面里", () => {
  it("跨行 import 少一个导出 ⇒ 报（这一条就是立尺根因；逐行取料的那版对它失明）", () => {
    const texts = new Map([
      ["src/consumer.ts", 'import {\n  keep,\n  gone,\n} from "./lib";'],
      ["src/lib.ts", "export const keep = 1;"],
    ]);
    const files = new Set(["src/consumer.ts", "src/lib.ts"]);
    const m = findMissingExports(edgesOf("src/consumer.ts", texts.get("src/consumer.ts")!), files, (rel) => texts.get(rel) ?? null);
    expect(m.map((x) => `${x.target}:${x.symbol}`)).toEqual(["src/lib.ts:gone"]);
  });

  it("合法写法一律不许报：再导出、内联 type、as 改名、`export type {}`", () => {
    const lib = ["export const MODES = [];", "export type Mode = string;", "export function rank() {}", "export { MODES as ALL };"].join("\n");
    const idx = 'export { MODES, type Mode, rank, ALL } from "./lib";';
    const files = new Set(["src/idx.ts", "src/lib.ts"]);
    const m = findMissingExports(edgesOf("src/idx.ts", idx), files, (rel) => (rel === "src/lib.ts" ? lib : null));
    expect(m).toEqual([]);
  });

  it("目标看不全（`export *`）⇒ 整份不判", () => {
    const files = new Set(["src/consumer.ts", "src/lib.ts"]);
    const m = findMissingExports(edgesOf("src/consumer.ts", 'import { anything } from "./lib";'), files, () => 'export * from "./other";');
    expect(m).toEqual([]);
  });

  it("模块本身缺失时不报符号（归悬空那一半，一条缺陷不许报两次）", () => {
    const files = new Set(["src/consumer.ts"]);
    const m = findMissingExports(edgesOf("src/consumer.ts", 'import { whatever } from "./nope";'), files, () => null);
    expect(m).toEqual([]);
  });

  it("豁免表外新出现的缺失即红；补好后 stale 红（两张表同一个规矩）", () => {
    const missing = [{ target: "src/lib.ts", symbol: "gone", importers: ["src/a.ts"] }];
    const key = "src/lib.ts:gone";
    expect(checkMissingSymbols(missing, { [key]: "第 135 页：示例" })).toEqual([]);
    expect(checkMissingSymbols(missing, {}).map((f) => f.kind)).toEqual(["missing-symbol"]);
    expect(checkMissingSymbols([], { [key]: "第 135 页：示例" }).map((f) => f.kind)).toEqual(["stale-waiver"]);
  });
});

describe("parseBatchResponse：半份正文不能当成整份导出面", () => {
  it("齐的照单收；`missing` 只占一行，不吞掉下一条", () => {
    const m = parseBatchResponse(["a.ts", "b.ts"], Buffer.from("aaa blob 3\nabc\nbbb blob 1\nx\n"));
    expect(m && [...m.entries()]).toEqual([["a.ts", "abc"], ["b.ts", "x"]]);
    const withMissing = parseBatchResponse(["a.ts", "gone.ts"], Buffer.from("aaa blob 3\nabc\ngone.ts missing\n"));
    expect(withMissing && [...withMissing.keys()]).toEqual(["a.ts"]);
  });

  it("回包形状不认识 ⇒ 整批判「未取」，不交半份面（交了就是拿不存在当自洽）", () => {
    expect(parseBatchResponse(["a.ts", "b.ts"], Buffer.from("aaa blob 3\nabc\nwtf\n"))).toBeNull();
    expect(parseBatchResponse(["a.ts"], Buffer.from("aaa blob 9\nabc\n"))).toBeNull(); // 声称 9 字节、只回 3
  });
});

describe("findDanglingImports ＋ 豁免表", () => {
  it("解析不到的相对路径算悬空，并按引用者数排序（多的先看见）", () => {
    const d = findDanglingImports([
      { from: "src/a.ts", spec: "./missing" },
      { from: "src/tools/x.ts", spec: "../missing2" },
      { from: "src/b.ts", spec: "./missing" },
    ], FILES, noDisk);
    expect(d.map((x) => x.target)).toEqual(["src/missing.ts", "src/missing2.ts"]);
  });

  it("两态分开判：盘上有＝「漏 git add」，盘上也没有＝「引用写错/模块被删」", () => {
    const edges = [{ from: "src/a.ts", spec: "./missing" }];
    expect(findDanglingImports(edges, FILES, allDisk)[0]?.onDisk).toBe(true);
    expect(findDanglingImports(edges, FILES, noDisk)[0]?.onDisk).toBe(false);
    const f = checkHeadImportFace(findDanglingImports(edges, FILES, allDisk), {});
    expect(f[0]?.detail).toContain("漏 `git add`");
    const g = checkHeadImportFace(findDanglingImports(edges, FILES, noDisk), {});
    expect(g[0]?.detail).toContain("盘上也没有");
  });

  it("豁免是双向的：名单内不红；不再悬空则 stale 红（不许静默烂在表里）", () => {
    const edges = [{ from: "src/a.ts", spec: "./missing" }];
    const dang = findDanglingImports(edges, FILES, allDisk);
    expect(checkHeadImportFace(dang, { "src/missing.ts": "示例理由" })).toEqual([]);
    const stale = checkHeadImportFace([], { "src/missing.ts": "示例理由" });
    expect(stale.map((x) => x.kind)).toEqual(["stale-waiver"]);
  });

  it("同一文件指自己不算悬空（副作用式 `import \"./x\"` 会解析回自己）", () => {
    expect(findDanglingImports([{ from: "src/a.ts", spec: "./a" }], new Set(["src/a.ts"]), noDisk)).toEqual([]);
  });
});

describe("真表自证：这把尺不许是空载的，也不许对事故那笔失明", () => {
  it("取料面自证：HEAD 里文件数与 import 边数都在量级上（读空＝没尺，不判）", () => {
    const got = collectHeadEdges();
    expect(got).not.toBeNull();
    expect(got!.headFiles.size).toBeGreaterThan(300);
    expect(got!.edges.length).toBeGreaterThan(1500);
  });

  it("取料自证：`cat-file --batch` 必须把文件表里每一份都真读到（半份面判绿＝假绿）", () => {
    const got = collectHeadEdges();
    expect(got).not.toBeNull();
    expect(got!.texts.size).toBe(got!.headFiles.size);
    for (const p of ["scripts/head-import-face.ts", "src/main/agent-runner.ts"]) {
      expect(got!.texts.get(p) ?? "").not.toBe("");
    }
    expect(readHeadBlobs("HEAD", ["no/such/file.ts"])?.size).toBe(0);
  });

  it("HEAD 现读：悬空集合必须**落在存量名单里**，且 finding 为 0（新增即红；名单里的补好了由 stale 那条逼人来删名）", () => {
    const got = collectHeadEdges();
    if (got === null) return; // 上一条已经红了
    const dang = findDanglingImports(got.edges, got.headFiles, () => true);
    for (const d of dang) expect(Object.keys(HEAD_DANGLING_WAIVERS)).toContain(d.target);
    expect(checkHeadImportFace(dang)).toEqual([]);
  });

  it("HEAD 现读（符号那一半）：缺失集合同样必须落在名单里，且 finding 为 0", () => {
    const got = collectHeadEdges();
    if (got === null) return;
    const missing = findMissingExports(got.edges, got.headFiles, (rel) => got.texts.get(rel) ?? null);
    for (const m of missing) expect(Object.keys(HEAD_MISSING_SYMBOL_WAIVERS)).toContain(m.target + ":" + m.symbol);
    expect(checkMissingSymbols(missing)).toEqual([]);
  });

  it("事故那一笔（`834ba3a`）必须整条咬住：4 条模块悬空 ＋ `SessionTransport` 符号缺失", () => {
    const got = collectHeadEdges("834ba3a");
    if (got === null) return; // rev 不在了不算红（本仓不 rewrite history，真在时这条必过）
    const dang = findDanglingImports(got.edges, got.headFiles, () => true);
    const missing = findMissingExports(got.edges, got.headFiles, (rel) => got.texts.get(rel) ?? null);
    expect(dang.map((d) => d.target).sort()).toEqual([
      "src/main/provider-runtime.ts", "src/main/run-attachments.ts", "src/main/run-request.ts", "src/providers/capabilities.ts",
    ]);
    expect(missing.map((m) => m.target + ":" + m.symbol)).toEqual(["src/agent/glm-session.ts:SessionTransport"]);
  });

  it("干净的那一笔（`69fbb0d`）必须 0 项：尺不许靠假红证明自己在干活", () => {
    const got = collectHeadEdges("69fbb0d");
    if (got === null) return;
    expect(findDanglingImports(got.edges, got.headFiles, () => true)).toEqual([]);
    expect(findMissingExports(got.edges, got.headFiles, (rel) => got.texts.get(rel) ?? null)).toEqual([]);
  });

  it("换 rev 也能跑（`--at` 的用面）：上一笔的取料结果与 HEAD 不是同一份常量", () => {
    const head = collectHeadEdges();
    const prev = collectHeadEdges("HEAD~1");
    expect(prev).not.toBeNull();
    expect(prev!.edges.length).toBeGreaterThan(1500);
    expect(head!.headFiles.size).toBeGreaterThanOrEqual(prev!.headFiles.size - 20);
  });

  it("存量每条必须带理由且点名是哪一页判的（两张表都算）", () => {
    for (const [t, why] of Object.entries({ ...HEAD_DANGLING_WAIVERS, ...HEAD_MISSING_SYMBOL_WAIVERS })) {
      expect(why.trim(), `${t} 缺理由`).not.toBe("");
      expect(why, `${t} 理由里没写出处`).toMatch(/第 [\d/]+ 页/);
    }
  });
});

/* 模板字面量里的「源码形状的数据」不算边。
 * 立尺的实测（2026-10-02）：`tests/eval-heldout.test.ts` 把三份 JS 源文件内容写成 `String.raw` 片段
 * （那是判卷要写进临时靶子的**数据**），其中一行正好是行首的 `import { subtotal } from "./cart.js";`
 * ⇒ 语句边界那一道拦不住（它本来就长得像一条合法语句），这把尺给我刚提交的那笔报了
 * 两条假悬空，认证树当场红一道 `head-import-check`。
 * 这一族的方向是**假红**；而把它做过头（连真边一起涂掉）就是**假绿**——所以每一半都配了用例。 */
describe("blankDataSpans：模板字面量是数据，普通字符串与真语句仍是边", () => {
  /** 一个「行首 import 藏在模板字面量里」的宿主文件——先证明它真的长得像一条语句。 */
  const host = [
    "const FIXTURE = `",
    "import { subtotal } from \"./cart.js\";",
    "export function checkoutTotal() { return 1; }",
    "`;",
    "import { keep } from \"./keep.js\";",
    "const dyn = await import(\"./dyn.js\");",
    "const bare = \"import { fake } from \\\"./fake.js\\\";\";",
  ].join("\n");

  it("前提成立：那句假 import 确实在行首（不然这条判卷是在测不存在的东西）", () => {
    expect(host.split("\n").some((l) => /^import \{ subtotal \} from "/.test(l))).toBe(true);
  });

  it("模板字面量里的源码不算边，字面量外的真语句照旧算", () => {
    const specs = parseImportStatements(host).map((s) => s.spec).sort();
    expect(specs).toEqual(["./dyn.js", "./keep.js"]);
    expect(specs).not.toContain("./cart.js");
  });

  it("导出一半也不认模板里的假源码（那一侧的后果是假绿：缺失符号被读成存在）", () => {
    const inTemplate = exportedNames("const SRC = `\nexport function cheat() {}\n`;\n");
    expect(inTemplate.names.has("cheat")).toBe(false);
    // 反向哨兵：真 export 必须还认（四种写法都验，涂白过头会静默把导出面涂没）
    const real = exportedNames([
      "export function fn() {}",
      "export const c = 1;",
      "export class K {}",
      "export interface I {}",
      "export { a, b as renamed };",
      "export type { T };",
      "export default 1;",
    ].join("\n"));
    for (const n of ["fn", "c", "K", "I", "a", "renamed", "T", "default"]) expect(real.names.has(n)).toBe(true);
  });

  it("等长涂白：长度与行数都不许变（报告里那句「第几行」要还指得对）", () => {
    const blanked = blankDataSpans(host);
    expect(blanked.length).toBe(host.length);
    expect(blanked.split("\n").length).toBe(host.split("\n").length);
    expect(blanked).not.toContain("./cart.js");
  });

  it("真表自证：带着源码片段的那份判卷今天贡献 0 条边", () => {
    const got = collectHeadEdges();
    if (got === null) return; // 取料本身坏了由上面几条红，这里不重复
    const fromJudge = (got.edges as HeadEdge[]).filter((e) => e.from === "tests/eval-heldout.test.ts");
    // 它真有几条边（scripts/lib/…、src/…），但绝不能有 cart/discount 那两条假悬空
    expect(fromJudge.length).toBeGreaterThan(0);
    expect(fromJudge.map((e) => e.spec)).not.toContain("./cart.js");
  });
});
