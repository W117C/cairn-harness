// 成员位名字不接**跨文件**的 ref→def 边（`crossFile: false` 这条链）。
//
// 动因（2026-10-20 落地 2026-10-03 的 rescue 分支上那个未落地的实验）：
// 成员名（类方法／类字段／接口成员）只能经 `obj.name` 被别处触到，而那种写法走属性/选择器纪律、
// **根本不进图** ⇒ 把成员名当跨文件可链接定义，等于凭空造依赖。
// 真仓读数（2026-10-02 全量图构建）：`src/agent/ledger.ts` 的 `private readFile` 吸了
// **107 个文件**的同名 ref、`src/tools/grep.ts` 的 `run` 吸 23 个——一条成员定义横跨上百个文件，
// 还把地图前排占成假枢纽（影响面分析的第一位因此指向一个谁也调不到它的私有方法）。
//
// 两条纪律：
//  ① 每一格都要配一个**能杀掉它的突变体**（改回旧形状 ⇒ 对应用例必须红）。
//  ② **不许砍掉真依赖**（比假边更坏）：所以口径是「成员位**独占**」——同一个文件里若还有一个
//     非成员位的同名 def，这个名字在那个文件里就是模块级可得的 ⇒ 不闸它。
import { describe, expect, it } from "vitest";
import { fileTags, __resetLangCache, __resetQueryCache } from "../src/agent/map/parse.js";
import { buildGraph, edgeWeight, type FileTagsInput } from "../src/agent/map/rank.js";
import type { SymbolTag } from "../src/agent/map/parse.js";

/** 造一个文件：tags 里 `crossFile: false` 的那些算成员位。 */
function file(file: string, pairs: [string, "def" | "ref", number, boolean?][]): FileTagsInput {
  return {
    file,
    tags: pairs.map(([name, kind, line, member]) => {
      const t: SymbolTag = { name, kind, line };
      if (member === true) t.crossFile = false;
      return t;
    }),
  };
}

describe("成员位名字不接跨文件边（parse 层）", () => {
  it("类方法被标成 crossFile:false；类名与模块级函数不被标", async () => {
    __resetLangCache();
    __resetQueryCache();
    const src = [
      "export function moduleLevel() { return 1; }",
      "class Repo {",
      "  save() { return 2; }",
      "}",
      "const inst = new Repo();",
    ].join("\n");
    const tags = await fileTags(src, "ts");
    const defs = tags.filter((t) => t.kind === "def");
    const byName = (n: string) => defs.filter((t) => t.name === n);

    // 成员位：标上了
    expect(byName("save").length).toBeGreaterThan(0);
    expect(byName("save").every((t) => t.crossFile === false)).toBe(true);

    // 非成员位：**不许**被标（标了就等于把可跨文件引用的名字也砍了）
    expect(byName("moduleLevel").length).toBeGreaterThan(0);
    expect(byName("moduleLevel").every((t) => t.crossFile === undefined)).toBe(true);
    // 类的名字本身可跨文件引用（`new Repo()`）⇒ 同样不许标
    expect(byName("Repo").length).toBeGreaterThan(0);
    expect(byName("Repo").every((t) => t.crossFile === undefined)).toBe(true);
  });

  it("go 的方法同样标成成员位（它的 def 走另一条 pattern，不是 ts 那条）", async () => {
    __resetLangCache();
    __resetQueryCache();
    const src = [
      "package main",
      "",
      "type Repo struct{}",
      "",
      "func (r *Repo) Save() int { return 1 }",
      "",
      "func Helper() {}",
    ].join("\n");
    const defs = (await fileTags(src, "go")).filter((t) => t.kind === "def");
    const save = defs.filter((t) => t.name === "Save");
    expect(save.length).toBeGreaterThan(0);
    expect(save.every((t) => t.crossFile === false)).toBe(true);
    const helper = defs.filter((t) => t.name === "Helper");
    expect(helper.length).toBeGreaterThan(0);
    expect(helper.every((t) => t.crossFile === undefined)).toBe(true);
  });

  it("模块级变量声明（const helper = …）不被当成员位", async () => {
    __resetLangCache();
    __resetQueryCache();
    const tags = await fileTags("const helper = 1;\nexport function use() { return helper; }\n", "ts");
    const helper = tags.filter((t) => t.kind === "def" && t.name === "helper");
    expect(helper.length).toBeGreaterThan(0);
    expect(helper.every((t) => t.crossFile === undefined)).toBe(true);
  });
});

describe("成员位名字不接跨文件边（构图层）", () => {
  it("跨文件的 ref 不连到成员位独占的 def", () => {
    const g = buildGraph([
      file("a.ts", [["doThing", "def", 1, true]]),
      file("b.ts", [["doThing", "ref", 1]]),
    ]);
    expect(edgeWeight(g, "b.ts", "doThing", "a.ts")).toBe(0);
  });

  it("同文件内的自调用照旧连（类内调用是真依赖）", () => {
    const g = buildGraph([
      file("a.ts", [["doThing", "def", 1, true], ["doThing", "ref", 2]]),
    ]);
    expect(edgeWeight(g, "a.ts", "doThing", "a.ts")).toBeGreaterThan(0);
  });

  it("同一个文件里若还有模块级的同名 def ⇒ 不闸它（宁可留假边，不许砍真边）", () => {
    const g = buildGraph([
      // a.ts 里既有类方法 doThing，也有模块级 doThing ⇒ 这个名字在 a.ts 是模块级可得的
      file("a.ts", [["doThing", "def", 1, true], ["doThing", "def", 20]]),
      file("b.ts", [["doThing", "ref", 1]]),
    ]);
    expect(edgeWeight(g, "b.ts", "doThing", "a.ts")).toBeGreaterThan(0);
  });

  it("import 钉不到成员位独占的 def（模块导不出一个私有方法）", () => {
    const g = buildGraph([
      file("a.ts", [["helper", "def", 1, true]]),
      file("b.ts", [["helper", "ref", 1]]),
    ], {});
    // 手工加一条 import 面：对面的 helper 只挂在成员位上 ⇒ 这条 import 无解，不许硬钉
    const g2 = buildGraph([
      { file: "a.ts", tags: [{ name: "helper", kind: "def", line: 1, crossFile: false }] },
      {
        file: "b.ts",
        tags: [{ name: "helper", kind: "ref", line: 1 }],
        imports: [{ name: "helper", spec: "./a.js", typeOnly: false, line: 1 }],
      },
    ]);
    expect(edgeWeight(g2, "b.ts", "helper", "a.ts")).toBe(0);
    // 计数要如实：它算「对面没这个名字」，不算「接上了」
    expect(g2.importStats.edges).toBe(0);
    expect(g2.importStats.resolvedNoDef).toBe(1);
    expect(g).toBeTruthy();
  });
});
