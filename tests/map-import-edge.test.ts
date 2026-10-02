// 能力 1（任务 #14 后半）：import 面 → 精确边的判卷。
//
// 立案动因（10-02 现读）：地图与波及面的边只靠**裸名 def/ref 相遇**，`rank.ts`/`parse.ts` 对 import
// 说明符零处理 ⇒ 枢纽文件 `src/main/settings.ts` 的 28 个节点全是 def、最好一个排全图 14998 里的
// 第 1932（文件级 233/583），三档预算全都进不了渲染面，locate-recall 的正哨兵连轮 MISS。
// 普查（`outputs/map-import-edges-2026-10-02/import-census-ast.log`）：候选面 583 文件里具名说明符 7875 条
// （值 6721／类型 1154），而**仓内相对说明符漏解析 = 0 条** ⇒ 这条解析是完备的。
//
// 判卷形状（本仓规矩）：
// · 语义判据走合成输入（不碰盘）——真仓数据分辨不了「精确」与「同名全连」的差；
// · 每条都配反向那一半（该在的在、该没的没有），尤其是「不许因为新维度少边」那条；
// · 缓存两支（冷/热）各跑一次比字节——只硬化一支是本仓第十族。
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isInternalSpecifier, normalizeRelPath, resolveModuleSpecifier } from "../src/agent/map/import-edge.js";
import { buildGraph, edgeWeight, type FileTagsInput } from "../src/agent/map/rank.js";
import { fileSymbols, fileTags, TAGS_EXTRACT_VERSION, __resetLangCache, __resetQueryCache, type ImportRef, type SymbolTag } from "../src/agent/map/parse.js";
import { createMapBuilder } from "../src/agent/map/build.js";

// ---- 合成取料 ----
function f(file: string, tags: [string, "def" | "ref", number][], imports: ImportRef[] = []): FileTagsInput {
  return { file, tags: tags.map(([name, kind, line]) => ({ name, kind, line }) as SymbolTag), imports };
}
const imp = (name: string, spec: string, line = 1, typeOnly = false): ImportRef => ({ name, spec, typeOnly, line });

describe("说明符解析（纯函数，不碰盘）", () => {
  it("内部 vs 外部：相对与根绝对进图，包名与 node: 一律不收", () => {
    expect(isInternalSpecifier("./a.js")).toBe(true);
    expect(isInternalSpecifier("../a.js")).toBe(true);
    expect(isInternalSpecifier("/src/a.ts")).toBe(true);
    expect(isInternalSpecifier("vitest")).toBe(false);
    expect(isInternalSpecifier("node:fs/promises")).toBe(false);
  });

  it("原样命中优先于换后缀：`./b.js` 在 b.js 与 b.ts 并存时解成 b.js", () => {
    const known = new Set(["a/b.js", "a/b.ts"]);
    expect(resolveModuleSpecifier("a/x.ts", "./b.js", known)).toBe("a/b.js");
  });

  it("ESM 写法换后缀与无后缀两种形状都吃（本仓源码写 .js 而盘上是 .ts）", () => {
    const known = new Set(["a/b.ts"]);
    expect(resolveModuleSpecifier("a/x.ts", "./b.js", known)).toBe("a/b.ts");
    expect(resolveModuleSpecifier("a/x.ts", "./b", known)).toBe("a/b.ts");
    expect(resolveModuleSpecifier("x.ts", "./b", known)).toBeNull(); // 仓根没有 b
  });

  it("index 兜底只在前两档都不中时生效（a.ts 与 a/index.ts 并存时不许解进目录）", () => {
    const both = new Set(["a/x.ts", "a/x/index.ts"]);
    expect(resolveModuleSpecifier("a/y.ts", "./x", both)).toBe("a/x.ts");
    const onlyDir = new Set(["a/x/index.ts"]);
    expect(resolveModuleSpecifier("a/y.ts", "./x", onlyDir)).toBe("a/x/index.ts");
  });

  it("上一级能追、越出仓根给 null（不许留一串 ../ 当文件名）", () => {
    expect(resolveModuleSpecifier("src/a/b.ts", "../c.js", new Set(["src/c.ts"]))).toBe("src/c.ts");
    expect(normalizeRelPath("src/a", "../../../escape.ts")).toBeNull();
    expect(resolveModuleSpecifier("src/a/b.ts", "../../../escape.ts", new Set(["escape.ts"]))).toBeNull();
  });
});

describe("import 精确边（buildGraph）", () => {
  it("A 从 b 取 Thing 而 decoy c 也定义 Thing ⇒ 只连 b，不连 c（#9 歧义在这一格闭合）", () => {
    const g = buildGraph([
      f("a.ts", [], [imp("Thing", "./b.js")]),
      f("b.ts", [["Thing", "def", 3]]),
      f("c.ts", [["Thing", "def", 9]]),
    ]);
    expect(edgeWeight(g, "a.ts", "Thing", "b.ts")).toBeGreaterThan(0);
    expect(edgeWeight(g, "a.ts", "Thing", "c.ts"), "钉住之后同名全连那支必须跳过它").toBe(0);
    expect(g.importStats.edges).toBe(1);
  });

  it("类型导入不入图：没有边，且它在计数里单独可见（不许静默吞掉）", () => {
    const g = buildGraph([
      f("a.ts", [], [imp("T", "./b.js", 2, true)]),
      f("b.ts", [["T", "def", 3]]),
    ]);
    expect(edgeWeight(g, "a.ts", "T", "b.ts")).toBe(0);
    expect(g.importStats.typeOnlySkipped).toBe(1);
    expect(g.importStats.refs, "refs 只数运行边：类型那档不进这个分母").toBe(0);
    expect(g.nodes.some((n) => n.file === "a.ts" && n.kind === "ref"), "类型导入不该造出 ref 节点").toBe(false);
  });

  it("对面没有这个名字（re-export 链）⇒ 不钉住，回落到同名全连：真依赖一条不少", () => {
    const g = buildGraph([
      f("a.ts", [], [imp("Thing", "./mid.js")]),          // mid 只是 re-export，自己没有 Thing
      f("mid.ts", []),
      f("real.ts", [["Thing", "def", 4]]),
    ]);
    expect(g.importStats.resolvedNoDef).toBe(1);
    expect(g.importStats.edges).toBe(0);
    expect(edgeWeight(g, "a.ts", "Thing", "real.ts"), "回落不许把已有的同名边弄丢").toBe(0);
    // 上面那句是"没钉住 ⇒ a.ts 里没有 ref 节点"的形状；真正兜住回落的是**有 ref tag** 的那条用例：
    const g2 = buildGraph([
      f("a.ts", [["Thing", "ref", 7]], [imp("Thing", "./mid.js")]),
      f("mid.ts", []),
      f("real.ts", [["Thing", "def", 4]]),
    ]);
    expect(edgeWeight(g2, "a.ts", "Thing", "real.ts"), "解析不到 def 时走同名全连，边必须在").toBeGreaterThan(0);
  });

  it("外部包不给它造节点（否则 describe/expect 这种名字会污染整张图）", () => {
    const g = buildGraph([f("a.ts", [], [imp("describe", "vitest"), imp("readFile", "node:fs/promises")])]);
    expect(g.importStats.external).toBe(2);
    expect(g.nodes.filter((n) => n.file === "a.ts").length).toBe(0);
  });

  it("老取料面（压根没带 imports）与带的图逐字节同形：新维度不许让现有的边变少", () => {
    const withOut = buildGraph([f("a.ts", [["Thing", "ref", 3]]), f("b.ts", [["Thing", "def", 1]])]);
    const withEmpty = buildGraph([f("a.ts", [["Thing", "ref", 3]], []), f("b.ts", [["Thing", "def", 1]])]);
    const withUnresolved = buildGraph([
      f("a.ts", [["Thing", "ref", 3]], [imp("Thing", "./nope.js")]),
      f("b.ts", [["Thing", "def", 1]]),
    ]);
    const sizeOf = (g: typeof withOut): string =>
      g.nodes.map((n) => `${n.file}#${n.name}:${n.kind}`).sort().join("|") +
      "::" + [...g.adj.entries()].map(([u, m]) => u + "→" + [...m.keys()].sort().join(",")).sort().join(";");
    expect(sizeOf(withEmpty)).toBe(sizeOf(withOut));
    expect(sizeOf(withUnresolved)).toBe(sizeOf(withOut));
  });

  it("import 了但本地没用 ⇒ 仍建出 ref 节点，PageRank 才有可流的边", () => {
    const g = buildGraph([
      f("a.ts", [], [imp("HUB", "./b.js")]),
      f("b.ts", [["HUB", "def", 1]]),
    ]);
    expect(g.nodes.some((n) => n.file === "a.ts" && n.name === "HUB" && n.kind === "ref")).toBe(true);
    expect(edgeWeight(g, "a.ts", "HUB", "b.ts")).toBeGreaterThan(0);
  });

  it("四个计数合起来等于喂进去的运行边条数（分母自证，缺格就红）", () => {
    const g = buildGraph([
      f("a.ts", [], [
        imp("Thing", "./b.js"),                 // 精确
        imp("gone", "./nope.js"),               // 外部
        imp("re", "./mid.js"),                  // 解析到但对面没这名字
        imp("T", "./b.js", 4, true),            // 类型 ⇒ 不进 refs
      ]),
      f("b.ts", [["Thing", "def", 1]]),
      f("mid.ts", []),
    ]);
    const s = g.importStats;
    expect(s.refs).toBe(3);
    expect(s.edges + s.external + s.resolvedNoDef).toBe(s.refs);
    expect([s.edges, s.external, s.resolvedNoDef, s.typeOnlySkipped]).toEqual([1, 1, 1, 1]);
  });
});

describe("parse 端：一次解析两个出口", () => {
  const SRC = [
    `import { VALUE } from "./x.js";`,
    `import type { T1 } from "./x.js";`,
    `import { VALUE2, type T2 } from "./x.js";`,
    `export { VALUE3 } from "./x.js";`,
    `export type { T3 } from "./x.js";`,
    `import * as ns from "./x.js";`,
    `import "./side-effect.js";`,
    `export const LOCAL = 1;`,
  ].join("\n");

  it("五档形状各判一次：语句级 type 与行内 type 都要认（缺一个就漏一类）", async () => {
    const { imports } = await fileSymbols(SRC, "ts");
    const byName = new Map(imports.map((i) => [i.name, i.typeOnly]));
    expect([...byName.keys()].sort()).toEqual(["T1", "T2", "T3", "VALUE", "VALUE2", "VALUE3"]);
    expect(byName.get("T1"), "import type { T1 }").toBe(true);
    expect(byName.get("T2"), "import { type T2 }").toBe(true);
    expect(byName.get("T3"), "export type { T3 } from —— 第一版探针就在这档漏了").toBe(true);
    expect(byName.get("VALUE")).toBe(false);
    expect(imports.filter((i) => !i.typeOnly).every((i) => i.spec === "./x.js"), "说明符原文要能喂给解析器").toBe(true);
  });

  it("namespace／裸 side-effect／本文件 export 都不出具名依赖（不收，而不是收假的）", async () => {
    const { imports } = await fileSymbols(`import * as ns from "./x.js";\nimport "./s.js";\nexport const LOCAL = 1;\n`, "ts");
    expect(imports).toEqual([]);
  });

  it("fileTags 只是薄壳：同一输入的 tags 与 fileSymbols().tags 逐字相等", async () => {
    const a = await fileTags(SRC, "ts");
    const b = (await fileSymbols(SRC, "ts")).tags;
    expect(a).toEqual(b);
  });

  it("不认识的后缀两个出口都空而不抛（老契约：解析失败不炸图）", async () => {
    const r = await fileSymbols("x = 1", "xyz");
    expect(r.tags).toEqual([]);
    expect(r.imports).toEqual([]);
  });
});

describe("接线（算出来不接＝本仓那一族）", () => {
  const buildSrc = readFileSync(fileURLToPath(new URL("../src/agent/map/build.ts", import.meta.url)), "utf8");
  const parseSrc = readFileSync(fileURLToPath(new URL("../src/agent/map/parse.ts", import.meta.url)), "utf8");

  /** 针脚形状：钉「同一条 `inputs.push({...})` 里带着 imports」，不钉整串字面量。
   *  10-02 加第三个出口 `summary` 时，字面量针脚红成了「接线没了」——那是假阳性；
   *  结构式针脚以后加字段不动。**「算出来不接」仍然红**：`imports:` 不在那个对象里就选不中。 */
  it("冷建与热缓存两支都把 imports 递给图（只接其中一支＝同族只硬化一支）", () => {
    expect(buildSrc).toMatch(/inputs\.push\(\{[^}]*file: f\.rel[^}]*imports: hit\.imports[^}]*\}\)/);
    expect(buildSrc).toMatch(/inputs\.push\(\{[^}]*file: s\.f\.rel[^}]*imports: sym\.imports[^}]*\}\)/);
    // 三个出口也必须同进缓存：写的时候丢掉任何一个，下一次读就给出另一张图
    expect(buildSrc).toMatch(/const entry: TagsCacheEntry = \{[^}]*tags, imports, summary \};/);
  });

  it("import 与 export 两档图案都在（re-export 也是一种跨文件依赖）", () => {
    expect(parseSrc).toContain('const IMPORT_PATTERNS = ["(import_statement) @imp", "(export_statement) @exp"];');
    // 两个出口共用一次解析：fileTags 必须是薄壳，不许留第二份 parse 实现
    expect(parseSrc).toContain("return (await fileSymbols(src, ext)).tags;");
  });
});

describe("缓存两支必须给出同一张图（本仓第十族：只硬化一支）", () => {
  let ws: string;
  let dir: string;
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), "dsh-import-edge-"));
    dir = join(ws, "tags-cache");
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "hub.ts"), `export const HUB_NAME = 1;\nexport function hubFn(): number { return 2; }\n`, "utf8");
    await writeFile(join(ws, "src", "a.ts"), `import { HUB_NAME } from "./hub.js";\nconsole.log(HUB_NAME);\n`, "utf8");
    await writeFile(join(ws, "src", "b.ts"), `import { hubFn } from "./hub.js";\nconsole.log(hubFn());\n`, "utf8");
  });
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
    __resetLangCache();
    __resetQueryCache();
  });

  it("冷建与热重建的注入正文逐字节相同（缓存只回 tags 就会给出没边的另一张图）", async () => {
    const builder = createMapBuilder({ workspace: ws, tagsCacheDir: dir });
    const cold = await builder.build({ workspace: ws, tagsCacheDir: dir });
    const warm = await builder.build({ workspace: ws, tagsCacheDir: dir });
    expect(cold.ok && warm.ok).toBe(true);
    expect(cold.fromRenderCache, "第一次不该命中渲染缓存").toBe(false);
    expect(warm.text, "热缓存那支的图必须与冷建一致").toBe(cold.text);
  });

  it("缺 imports 字段的旧条目按 miss 处理（版本没变也要重解析，否则老仓永远没边）", async () => {
    const builder = createMapBuilder({ workspace: ws, tagsCacheDir: dir });
    await builder.build({ workspace: ws, tagsCacheDir: dir }); // 先让缓存暖起来（写入带 imports 的新格式）
    // 手工把 hub.ts 的条目降级成「只有 tags、没有 imports」的老形状，版本号照抄成当前值
    const files = await readdir(dir);
    const staleTarget = files.find((n) => n.endsWith(".json"));
    expect(staleTarget, "缓存目录里应有条目").toBeTruthy();
    for (const name of files) {
      const raw = JSON.parse(await readFile(join(dir, name), "utf8")) as Record<string, unknown>;
      delete raw.imports;
      raw.v = TAGS_EXTRACT_VERSION;
      await writeFile(join(dir, name), JSON.stringify(raw), "utf8");
    }
    const after = await builder.build({ workspace: ws, tagsCacheDir: dir, budgetTokens: 4096 });
    expect(after.fromTagsCache, "被降级的条目必须算 miss（重解析后才算数）").toBeLessThan(3);
    expect(after.ok).toBe(true);
  });
});
