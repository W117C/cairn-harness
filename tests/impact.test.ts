// M7 影响面层验收：跨文件调用边抽取 / 上下向查询 / 增量重解析 / 缓存不出仓库 / 坏 wasm fail-loud。
// 判卷靶子 = fixtures/impact/mini-repo（已知调用图）+ expect-edges.json（sha256 冻结）。
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildImpact,
  defaultImpactCacheDir,
  downward,
  fileImpact,
  ImpactUnavailableError,
  upward,
  type ImpactEdge,
  type ImpactGraph,
} from "../src/agent/impact/index.js";
import { __resetLangCache, __setWts } from "../src/agent/map/parse.js";

const MINI_REPO = fileURLToPath(new URL("../fixtures/impact/mini-repo", import.meta.url));
const EXPECT_EDGES: ImpactEdge[] = JSON.parse(
  await readFile(fileURLToPath(new URL("../fixtures/impact/expect-edges.json", import.meta.url)), "utf8"),
) as ImpactEdge[];

function edgeKey(e: { from: string; to: string; symbol: string; refLine: number; defLine: number }): string {
  return [e.from, e.to, e.symbol, e.refLine, e.defLine].join("\u241F");
}

async function freshBuild(): Promise<{ graph: ImpactGraph; cacheDir: string }> {
  const cacheDir = await mkdtemp(join(tmpdir(), "impact-test-"));
  const graph = await buildImpact({ workspace: MINI_REPO, cacheDir });
  return { graph, cacheDir };
}

describe("影响面·调用图抽取（mini-repo 判卷）", () => {
  it("①抽出的跨文件调用集 == expect-edges.json（集合相等）", async () => {
    const { graph } = await freshBuild();
    expect(graph.edges.map(edgeKey).sort()).toEqual(EXPECT_EDGES.map(edgeKey).sort());
  });

  it("②边数 = 6（判卷已知调用图）", async () => {
    const { graph } = await freshBuild();
    expect(graph.edges.length).toBe(6);
  });

  it("③每条期望边都在图里（逐条存在性）", async () => {
    const { graph } = await freshBuild();
    const have = new Set(graph.edges.map(edgeKey));
    for (const e of EXPECT_EDGES) expect(have.has(edgeKey(e))).toBe(true);
  });

  it("④文件清单 = 4 个源文件（workspace 相对、排序）", async () => {
    const { graph } = await freshBuild();
    expect(graph.files).toEqual(["app.js", "math.js", "metrics.ts", "utils.js"]);
  });

  it("⑤add 的定义点只在 utils.js:1", async () => {
    const { graph } = await freshBuild();
    const defs = graph.defs.get("add") ?? [];
    expect(defs).toEqual([{ symbol: "add", file: "utils.js", line: 1 }]);
  });

  it("⑥compute 的引用点 = app.js:5 与 metrics.ts:4（排序）", async () => {
    const { graph } = await freshBuild();
    expect(graph.refs.get("compute")).toEqual([
      { symbol: "compute", file: "app.js", line: 5 },
      { symbol: "compute", file: "metrics.ts", line: 4 },
    ]);
  });

  it("⑦向上：add 的跨文件调用方 = math.js:4, math.js:10, app.js:6", async () => {
    const { graph } = await freshBuild();
    expect(upward(graph, "add")).toEqual([
      { symbol: "add", file: "app.js", line: 6 },
      { symbol: "add", file: "math.js", line: 4 },
      { symbol: "add", file: "math.js", line: 10 },
    ]);
  });

  it("⑧向上：mul 的跨文件调用方 = math.js:5（utils.js 内自调用被排除）", async () => {
    const { graph } = await freshBuild();
    expect(upward(graph, "mul")).toEqual([{ symbol: "mul", file: "math.js", line: 5 }]);
  });

  it("⑨向下：math.js 调用谁 = utils.js:1(add) 与 utils.js:5(mul)", async () => {
    const { graph } = await freshBuild();
    expect(downward(graph, "math.js")).toEqual([
      { symbol: "add", file: "utils.js", line: 1 },
      { symbol: "mul", file: "utils.js", line: 5 },
    ]);
  });

  it("⑩向下：app.js 调用谁 = math.js:3(compute) 与 utils.js:1(add)（自身 main() 自调用排除）", async () => {
    const { graph } = await freshBuild();
    expect(downward(graph, "app.js")).toEqual([
      { symbol: "add", file: "utils.js", line: 1 },
      { symbol: "compute", file: "math.js", line: 3 },
    ]);
  });

  it("⑪向上：未知符号 → 空清单（不抛）", async () => {
    const { graph } = await freshBuild();
    expect(upward(graph, "no_such_symbol")).toEqual([]);
  });

  it("⑫向下：图中不存在的文件 → 空清单（不抛）", async () => {
    const { graph } = await freshBuild();
    expect(downward(graph, "ghost.js")).toEqual([]);
  });
});

describe("影响面·增量与缓存", () => {
  it("⑬首次构建（冷缓存）：parsed=4, fromTagsCache=0", async () => {
    const { graph } = await freshBuild();
    expect(graph.parsed).toBe(4);
    expect(graph.fromTagsCache).toBe(0);
  });

  it("⑭同缓存二次构建：parsed=0, fromTagsCache=4（全部命中，零重解析）", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "impact-test-"));
    const g1 = await buildImpact({ workspace: MINI_REPO, cacheDir });
    expect(g1.parsed).toBe(4);
    const g2 = await buildImpact({ workspace: MINI_REPO, cacheDir });
    expect(g2.parsed).toBe(0);
    expect(g2.fromTagsCache).toBe(4);
    expect(g2.edges.map(edgeKey).sort()).toEqual(EXPECT_EDGES.map(edgeKey).sort());
  });

  it("⑮改一个文件（mtime+size 变化）：只重解析该文件（parsed=1, cache=3），边集随之更新", async () => {
    const ws = await mkdtemp(join(tmpdir(), "impact-incr-"));
    const cacheDir = await mkdtemp(join(tmpdir(), "impact-incr-cache-"));
    for (const f of ["utils.js", "math.js", "app.js"]) {
      await writeFile(join(ws, f), await readFile(join(MINI_REPO, f)), "utf8");
    }
    const g1 = await buildImpact({ workspace: ws, cacheDir });
    expect(g1.parsed).toBe(3);
    // 改 math.js：新增一句对 mul 的调用 → 新边；utils.js/app.js 指纹未变 → 走缓存
    const mathSrc = await readFile(join(ws, "math.js"), "utf8");
    await writeFile(join(ws, "math.js"), mathSrc.replace("return boosted;", "return mul(boosted, mul(1, 2));"), "utf8");
    const g2 = await buildImpact({ workspace: ws, cacheDir });
    expect(g2.parsed).toBe(1);
    expect(g2.fromTagsCache).toBe(2);
    const hasNew = g2.edges.some((e) => e.symbol === "mul" && e.refLine === 6 && e.from === "math.js");
    expect(hasNew).toBe(true);
  });

  it("⑯用户仓库内无缓存文件（缓存只落 cacheDir；mini-repo 文件集不变）", async () => {
    const before = (await readdir(MINI_REPO)).sort();
    const cacheDir = await mkdtemp(join(tmpdir(), "impact-test-"));
    await buildImpact({ workspace: MINI_REPO, cacheDir });
    expect((await readdir(MINI_REPO)).sort()).toEqual(before);
  });

  it("⑰缓存条目落在指定 cacheDir 内（sha1(absPath).json，4 条）", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "impact-test-"));
    await buildImpact({ workspace: MINI_REPO, cacheDir });
    const entries = await readdir(cacheDir);
    expect(entries.length).toBe(4);
    expect(entries.every((f) => f.endsWith(".json"))).toBe(true);
  });

  it("⑱defaultImpactCacheDir 缺省 = 应用数据目录 ~/.m0-agent-loop/impact-tags", () => {
    delete process.env.M7_IMPACT_TAGS_DIR;
    expect(defaultImpactCacheDir()).toBe(join(homedir(), ".m0-agent-loop", "impact-tags"));
  });

  it("⑲defaultImpactCacheDir 尊重 M7_IMPACT_TAGS_DIR 环境变量", () => {
    process.env.M7_IMPACT_TAGS_DIR = "/tmp/impact-override";
    try {
      expect(defaultImpactCacheDir()).toBe("/tmp/impact-override");
    } finally {
      delete process.env.M7_IMPACT_TAGS_DIR;
    }
  });

  it("⑳确定性：两次独立构建的边集 JSON 逐字相同", async () => {
    const a = (await freshBuild()).graph;
    const b = (await freshBuild()).graph;
    expect(JSON.stringify(a.edges)).toBe(JSON.stringify(b.edges));
  });
});

describe("影响面·fileImpact（编辑后影响面）", () => {
  it("㉑math.js 的 fileImpact：symbols 含 compute/topUp，up = 二者的跨文件调用方（compute 被 app.js/metrics.ts 调用）", async () => {
    const r = await fileImpact(MINI_REPO, "math.js", await mkdtemp(join(tmpdir(), "impact-test-")));
    expect(r).not.toBeNull();
    expect(r!.symbols).toContain("compute");
    expect(r!.symbols).toContain("topUp");
    const keys = (r!.up.map((s) => s.symbol + "@" + s.file + ":" + s.line)).sort();
    expect(keys).toEqual(["compute@app.js:5", "compute@metrics.ts:4"]);
    expect(r!.truncated).toBe(false);
  });

  it("㉒utils.js 的 fileImpact：up = add/mul 的全部跨文件调用方（4 条）", async () => {
    const r = await fileImpact(MINI_REPO, "utils.js", await mkdtemp(join(tmpdir(), "impact-test-")));
    expect(r!.up.length).toBe(4);
    const files = r!.up.map((s) => s.file).sort();
    expect(files).toEqual(["app.js", "math.js", "math.js", "math.js"]);
  });

  it("㉓图中不存在的文件 → null（loop 钩子据此不发事件）", async () => {
    const r = await fileImpact(MINI_REPO, "ghost.ts", await mkdtemp(join(tmpdir(), "impact-test-")));
    expect(r).toBeNull();
  });
});

describe("影响面·坏 wasm fail-loud（判卷降级边界）", () => {
  it("㉔喂坏 wasm（Language.load 抛错）→ buildImpact 抛 ImpactUnavailableError 且文案含 unavailable", async () => {
    const broken = {
      Parser: { init: async () => {} },
      Language: { load: async () => { throw new Error("corrupted wasm (injected)"); } },
      Query: class {},
    } as unknown as typeof import("web-tree-sitter");
    __resetLangCache();
    __setWts(broken);
    try {
      let thrown: unknown = null;
      try {
        await buildImpact({ workspace: MINI_REPO, cacheDir: await mkdtemp(join(tmpdir(), "impact-test-")) });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ImpactUnavailableError);
      expect((thrown as Error).message).toContain("unavailable");
    } finally {
      __setWts(null);
      __resetLangCache();
    }
  });

  it("㉕坏 wasm 时 fileImpact 同样 fail-loud（不静默返回空）", async () => {
    const broken = {
      Parser: { init: async () => {} },
      Language: { load: async () => { throw new Error("corrupted wasm (injected)"); } },
      Query: class {},
    } as unknown as typeof import("web-tree-sitter");
    __resetLangCache();
    __setWts(broken);
    try {
      await expect(
        fileImpact(MINI_REPO, "utils.js", await mkdtemp(join(tmpdir(), "impact-test-"))),
      ).rejects.toMatchObject({ name: "ImpactUnavailableError" });
    } finally {
      __setWts(null);
      __resetLangCache();
    }
  });

  it("㉖坏 wasm 不影响单文件语法错误的静默降级（坏文件返回空 tags 不抛）", async () => {
    __setWts(null);
    __resetLangCache();
    const ws = await mkdtemp(join(tmpdir(), "impact-badfile-"));
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "ok.js"), "function alpha() { return 1; }\nexport { alpha };\n", "utf8");
    await writeFile(join(ws, "src", "broken.js"), "function oops( { \n", "utf8");
    const g = await buildImpact({ workspace: ws, cacheDir: await mkdtemp(join(tmpdir(), "impact-test-")) });
    // broken.js 解析不出 tags：不会贡献 def/ref，但 ok.js 正常
    expect(g.edges).toEqual([]);
    expect(g.files).toContain("src/broken.js");
  });
});

describe("影响面·边界", () => {
  it("㉗空工作区（无源文件）→ 空图不抛", async () => {
    const ws = await mkdtemp(join(tmpdir(), "impact-empty-"));
    const g = await buildImpact({ workspace: ws, cacheDir: await mkdtemp(join(tmpdir(), "impact-test-")) });
    expect(g.files).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.parsed).toBe(0);
  });
});

// ---- 跨文件边的精度（2026-09-23，待办 #43）----
// 判卷在 map-parse 那边测的是「抽不抽得到」，这一组测的是**模型实际读到的那一行**：
// 「改 a.ts 里的 X 会波及 n.ts」这件事到底成不成立。读数量见 outputs/impact-precision-2026-09-23.md
// （修前：本仓站点级边 194,292，只有 20% 由 import 支撑）。
describe("影响面·假边不再出现", () => {
  async function repo(files: Record<string, string>): Promise<ImpactGraph> {
    const ws = await mkdtemp(join(tmpdir(), "impact-precision-"));
    for (const [rel, src] of Object.entries(files)) {
      await mkdir(join(ws, rel.split("/").slice(0, -1).join("/") || ws), { recursive: true });
      await writeFile(join(ws, rel), src, "utf8");
    }
    return buildImpact({ workspace: ws, cacheDir: await mkdtemp(join(tmpdir(), "impact-precision-cache-")) });
  }

  it("两个文件各有一个同名局部变量 ⇒ 零条边（旧判据会连一条出去，因为局部变量也进了符号表）", async () => {
    const g = await repo({
      "m.ts": "export function host() { const target = () => 1; return target(); }\n",
      "n.ts": "export function other() { return target(); }\n",
    });
    expect(g.defs.has("target"), "函数体里的 const 不是跨文件符号").toBe(false);
    expect(g.edges.filter((e) => e.symbol === "target")).toEqual([]);
    // 成对的另一半：引用点照旧存在（说明不是「没抽到」而是「不相连」）。
    // 注意 `upward` 在「有引用、无定义」时返回的是全部引用点——那不是影响面，
    // 读端怎么处置这一格由 impact_query 的分诊负责（见 tests/impact-query.test.ts）。
    expect((g.refs.get("target") ?? []).map((r) => r.file).sort()).toEqual(["m.ts", "n.ts"]);
  });

  it("属性名不算引用：`console.log()` 连不上另一个文件里模块级的 `const log`", async () => {
    const g = await repo({
      "r.ts": "export const log = (m: string) => m;\n",
      "s.ts": "export function f() { console.log(\"hi\"); }\n",
    });
    expect(g.defs.has("log"), "模块级定义本身照进表（不是被删）").toBe(true);
    expect(g.edges.filter((e) => e.symbol === "log")).toEqual([]);
  });

  it("真依赖照旧连得上：模块级定义 + 别文件的裸调用", async () => {
    const g = await repo({
      "p.ts": "export const shared = () => 1;\n",
      "q.ts": "export function use() { return shared(); }\n",
    });
    const e = g.edges.filter((x) => x.symbol === "shared");
    expect(e.map((x) => `${x.from}→${x.to}`)).toEqual(["q.ts→p.ts"]);
  });
});
