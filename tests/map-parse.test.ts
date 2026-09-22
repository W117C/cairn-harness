// M2b 任务 1 验收（解析层）：四语言各抽到至少一个 def 与一个 ref；语法错误文件不抛、返回空 tags。
import { describe, expect, it } from "vitest";
import { fileTags, __resetLangCache, __resetQueryCache, __setWts } from "../src/agent/map/parse.js";

const SAMPLES: { ext: string; src: string }[] = [
  {
    ext: "ts",
    src: `export function computeTotal(items: string[]): number { return items.length; }\nclass Repo { save() { return 1; } }\nconst helper = computeTotal;\ncomputeTotal([]);`,
  },
  {
    ext: "tsx",
    src: `export function Badge(props: { label: string }) { return null; }\nconst other = Badge;\nBadge({ label: "x" });`,
  },
  {
    ext: "js",
    src: `function main() { helper(); }\nfunction helper() {}\nmain();`,
  },
  {
    ext: "py",
    src: `def run_job(name):\n    return helper(name)\n\ndef helper(x):\n    return x\n\nrun_job("a")`,
  },
];

describe("map parse（任务 1）", () => {
  it("四语言各抽到至少一个 def 与一个 ref", async () => {
    for (const s of SAMPLES) {
      const tags = await fileTags(s.src, s.ext);
      expect(tags.some((t) => t.kind === "def"), `${s.ext} 应有 def`).toBe(true);
      expect(tags.some((t) => t.kind === "ref"), `${s.ext} 应有 ref`).toBe(true);
      expect(tags.every((t) => Number.isInteger(t.line) && t.line >= 1), "行号 1-based").toBe(true);
      expect(tags.every((t) => t.name.length > 0), "名字非空").toBe(true);
    }
  });

  it("语法错误文件不抛、返回空 tags；坏扩展名不抛；grammar 加载失败向上抛（build 层降级）", async () => {
    const broken = "function {{{ nope";
    await expect(fileTags(broken, "ts")).resolves.toEqual([]);
    // 不认识的后缀 → 空
    await expect(fileTags("anything", "rs")).resolves.toEqual([]);
    // grammar 加载失败 → 抛（由 buildMap 捕获并静默降级为空地图）
    __resetLangCache();
    __resetQueryCache();
    __setWts({
      Parser: Object.assign(function () { throw new Error("boom"); }, { init: () => Promise.resolve() }),
      Language: { load: () => Promise.reject(new Error("bad grammar")) },
      Query: class {},
    } as never);
    await expect(fileTags("function ok() {}", "ts")).rejects.toThrow("bad grammar");
    __setWts(null);
    __resetLangCache();
    __resetQueryCache();
  });

  it("grammar 误报的合法 TS 不再整文件消失：ERROR 之外的定义照常回收", async () => {
    // 实测触发面（本仓 4 个合法文件因此此前在图里完全不存在）：类型位置里的 `import("pkg").T`
    // （`src/agent/map/parse.ts` 与两个 test 文件里的 `importOriginal<typeof import(...)>()`）、
    // 含双斜杠的正则字面量（`ipc-reachability-check-core.ts`）。旧口径「一票否决整文件」
    // 把错误节点**之外**的正常定义也一起丢了，而读端只会说「这张图里没有这个符号」。
    const src = [
      'type Alias = import("node:fs/promises").FsPromisesStatics;',
      "const reg = new Map<string, () => Promise<void>>();",
      "export function recoveredAfterNoise(): number { return reg.size; }",
    ].join("\n");
    const tags = await fileTags(src, "ts");
    const defs = tags.filter((t) => t.kind === "def").map((t) => t.name);
    expect(defs, "错误节点之后的正常函数必须还在图里").toContain("recoveredAfterNoise");
    expect(defs).toContain("reg");
    // 这条是**界**不是过滤器：图案本来就不吃类型实参（我一度加过一道「丢掉 ERROR 子树里的 capture」，
    // 实测 4 个真触发文件 + 7 种造出来的坏法都挡不到任何东西，已撤，理由记在 parse.ts 那段注释里）。
    expect(defs, "泛型实参不该被当成定义").not.toContain("void");
  });

  it("真仓库里那四个曾被一票否决的文件，如今每个都有定义入图（回归现场比合成夹具更硬）", async () => {
    const { readFile } = await import("node:fs/promises");
    // 这四个是 `probe-map-recall.ts` 首跑实测出来的：TS 认得过、tree-sitter 报 ERROR ⇒ 旧口径整文件丢弃。
    // 钉真文件而不是只钉夹具：夹具会随 grammar 升级失真，这四个是这条缺陷在本仓的存在证明。
    for (const rel of ["src/agent/map/parse.ts", "scripts/ipc-reachability-check-core.ts", "tests/secrets.test.ts", "tests/sessions.test.ts"]) {
      const src = await readFile(new URL("../" + rel, import.meta.url), "utf8");
      const defs = (await fileTags(src, "ts")).filter((t) => t.kind === "def");
      expect(defs.length, rel + " 不许整文件零抽取").toBeGreaterThan(0);
    }
  });

  it("行号指向声明/引用所在行（1-based）", async () => {
    const src = [
      "a = 1",
      "",
      "def target():",
      "    pass",
      "",
      "target()",
    ].join("\n");
    const tags = await fileTags(src, "py");
    const def = tags.find((t) => t.kind === "def" && t.name === "target");
    const ref = tags.find((t) => t.kind === "ref" && t.name === "target");
    expect(def?.line).toBe(3);
    expect(ref?.line).toBe(6);
  });
});

// ---- 抽取判据：同名不再相连（2026-09-23，待办 #43）----
// 动因（读数量见 outputs/impact-precision-2026-09-23.md）：本仓 400 文件的图里，14,312 个「定义」
// 有 10,184 个是**函数体里的局部变量**，47,303 个「引用」有 20,533 个是**属性名**
// （`console.log` 连到某个文件自己的 `const log = …`）。后果是单个 `log` 产出 45,160 条假边，
// 全部站点级边里只有 20% 由「调用方真的 import 了这个名字」支撑。
// 这四条测的是判据本身，两两成对：前两条各关一种噪声，第三条证明这不是「什么都不抽」，
// 第四条把**已知代价**钉住——`obj.method()` 连不上定义该方法的文件，将来要改得先让这条红。
describe("抽取判据：同名不再相连", () => {
  it("函数体里的变量声明不算定义，模块作用域的同名变量照算", async () => {
    const src = [
      "export const shared = 1;", // 行 1：模块级 ⇒ 该进表
      "function f() {",
      "  const shared = 2;", // 行 3：局部 ⇒ 不该进表（另一个文件不可能 import 它）
      "  return shared;",
      "}",
    ].join("\n");
    const tags = await fileTags(src, "ts");
    const defs = tags.filter((t) => t.kind === "def" && t.name === "shared");
    expect(defs.map((d) => d.line), "只应留下模块作用域那一条定义").toEqual([1]);
  });

  it("属性式调用不抽引用：console.log / obj.m() / new NS.Ctor() 都不算引用", async () => {
    const src = [
      "console.log(1);",
      "logger.write();",
      "const x = new NS.Ctor();",
      "plain();", // 只有这一条是裸标识符调用
    ].join("\n");
    const tags = await fileTags(src, "ts");
    const refs = tags.filter((t) => t.kind === "ref").map((t) => t.name);
    expect(refs, "属性名不是跨文件符号").toEqual(["plain"]);
    expect(refs).not.toContain("log");
    expect(refs).not.toContain("Ctor");
  });

  it("反面对照（判据不是一律不抽）：模块级箭头函数与它的调用仍成对进表", async () => {
    const src = ["const make = () => 1;", "make();"].join("\n");
    const tags = await fileTags(src, "ts");
    expect(tags.find((t) => t.kind === "def" && t.name === "make")?.line).toBe(1);
    expect(tags.find((t) => t.kind === "ref" && t.name === "make")?.line).toBe(2);
  });

  it("循环与分支头部的声明同样不算模块级（`for (const x of …)` 直接挂在 for 节点下，不在语句块里）", async () => {
    const src = ["for (const item of list) { use(item); }", "if (ok) { const inner = 1; }"].join("\n");
    const tags = await fileTags(src, "ts");
    const defs = tags.filter((t) => t.kind === "def").map((t) => t.name);
    expect(defs).not.toContain("item");
    expect(defs).not.toContain("inner");
    expect(defs, "这文件里一个模块级定义都没有").toEqual([]);
  });

  it("已知代价钉住：方法定义照进表，但 obj.m() 不产生引用 ⇒ 方法调用连不上定义文件", async () => {
    const src = ["class A { doIt() { return 1; } }", "const a = new A();", "a.doIt();"].join("\n");
    const tags = await fileTags(src, "ts");
    expect(tags.some((t) => t.kind === "def" && t.name === "doIt"), "method_definition 仍是定义").toBe(true);
    expect(
      tags.some((t) => t.kind === "ref" && t.name === "doIt"),
      "这条是**刻意取舍**（见 parse.ts 里的命名缺口注释）：要恢复方法调用边，得先解析 object 的绑定",
    ).toBe(false);
  });
});
