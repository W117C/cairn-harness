// 影响面准确率基准（任务书任务 2）：冻结夹具 fixtures/impact/accuracy-repo（导出/私有/
// 同名/重导出四类形状，10 文件）＋ 人工核对的 ground-truth.json（16 条跨文件调用边真值）。
// 断言 precision=1.0、recall≥0.9、解析零静默丢条（errors 计数不吞）、预登记 upward/downward
// 查询集逐条与真值一致。真值边数（16）打印进断言消息防漏——真值文件被改短时这里先红。
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildImpact, downward, upward, type ImpactEdge, type ImpactGraph } from "../src/agent/impact/index.js";
import { fileTags } from "../src/agent/map/parse.js";

const ACCURACY_REPO = fileURLToPath(new URL("../fixtures/impact/accuracy-repo/", import.meta.url));
const TRUTH = JSON.parse(
  await readFile(fileURLToPath(new URL("../fixtures/impact/accuracy-repo/ground-truth.json", import.meta.url)), "utf8"),
) as {
  edgeCount: number;
  edges: { from: string; refLine: number; symbol: string; to: string; defLine: number }[];
  boundary: { symbol: string; file: string; refLine: number; defLine: number; reason: string }[];
  expectedNonEdges: { file: string; line: number; symbol: string; reason: string }[];
  zeroRefSymbols: string[];
  upwardQueries: string[];
  downwardQueries: string[];
};

const EXPECTED_FILES = [
  "api.js", "helpers.js", "index.ts", "legacy-math.ts", "logger.ts",
  "math.ts", "order-service.ts", "report.ts", "strings.ts", "user-service.ts",
];

function edgeKey(e: Pick<ImpactEdge, "from" | "to" | "symbol" | "refLine" | "defLine">): string {
  return [e.from, e.to, e.symbol, e.refLine, e.defLine].join("\u241F");
}

async function buildFixtureGraph(): Promise<ImpactGraph> {
  const cacheDir = await mkdtemp(join(tmpdir(), "impact-accuracy-"));
  return buildImpact({ workspace: ACCURACY_REPO, cacheDir });
}

describe("影响面·准确率基准（accuracy-repo 冻结夹具）", () => {
  it("① 全图文件集 = 夹具 10 文件；解析零静默丢条（每文件 tags 非空，errors 计数不吞）", async () => {
    const graph = await buildFixtureGraph();
    expect(graph.files, "图内文件集 ≠ 夹具文件集（有文件被静默丢出图）").toEqual(EXPECTED_FILES);
    const errors: string[] = [];
    for (const rel of EXPECTED_FILES) {
      const src = await readFile(join(ACCURACY_REPO, rel), "utf8");
      const tags = await fileTags(src, rel.slice(rel.lastIndexOf(".") + 1));
      if (tags.length === 0) errors.push(`${rel}: 解析得 0 个 tag（语法错误或解析失败被吞）`);
    }
    expect(errors, `解析错误 ${errors.length} 条：${errors.join("；")}`).toEqual([]);
  });

  it("② 图边集逐条 == 真值边集（真值 edgeCount=" + TRUTH.edgeCount + "，多一条少一条都点名）", async () => {
    const graph = await buildFixtureGraph();
    const got = new Set(graph.edges.map(edgeKey));
    const want = new Set(TRUTH.edges.map(edgeKey));
    const extra = graph.edges.filter((e) => !want.has(edgeKey(e)));
    const missing = TRUTH.edges.filter((e) => !got.has(edgeKey(e)));
    expect(
      { extra, missing },
      `图 ${graph.edges.length} 条 / 真值 ${TRUTH.edgeCount} 条；图多出 ${extra.length} 条、真值缺 ${missing.length} 条` +
        `：多出=${extra.map(edgeKey)} 缺=${missing.map(edgeKey)}`,
    ).toEqual({ extra: [], missing: [] });
  });

  it("③ precision=1.0、recall≥0.9（按边集公式算，读数打印进消息）", async () => {
    const graph = await buildFixtureGraph();
    const got = new Set(graph.edges.map(edgeKey));
    const want = new Set(TRUTH.edges.map(edgeKey));
    const tp = [...got].filter((k) => want.has(k)).length;
    const fp = got.size - tp;
    const fn = want.size - tp;
    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);
    expect(
      precision,
      `precision=${precision}（tp=${tp} fp=${fp}）：图里有假边；真值 ${TRUTH.edgeCount} 条`,
    ).toBe(1.0);
    expect(
      recall,
      `recall=${recall}（tp=${tp} fn=${fn}）：真值边被图漏掉；真值 ${TRUTH.edgeCount} 条`,
    ).toBeGreaterThanOrEqual(0.9);
  });

  it("④ 预登记 upward 查询集：逐符号 == 真值派生引用点（零引用/同文件边界符号 = 空清单）", async () => {
    const graph = await buildFixtureGraph();
    for (const sym of TRUTH.upwardQueries) {
      // upward 是**引用点清单**（谁调用我，站点去重）——同名定义只是把 defFiles 摊宽，引用点不重复
      const want = [...new Set(
        TRUTH.edges.filter((e) => e.symbol === sym).map((e) => JSON.stringify([e.symbol, e.from, e.refLine])),
      )]
        .map((s) => { const [symbol, file, line] = JSON.parse(s) as [string, string, number]; return { symbol, file, line }; })
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
      expect(
        upward(graph, sym),
        `upward(${sym}) ≠ 真值（真值 ${want.length} 个引用点）`,
      ).toEqual(want);
    }
    // boundary（同文件调用）与零引用符号的读端形状：跨文件清单必须为空，且不许混入同文件站点
    for (const b of TRUTH.boundary) {
      const up = upward(graph, b.symbol);
      expect(
        up,
        `${b.symbol} 的同文件调用（${b.file}:${b.refLine}→:${b.defLine}）混进了跨文件清单`,
      ).not.toContainEqual(expect.objectContaining({ file: b.file }));
    }
    for (const sym of TRUTH.zeroRefSymbols) {
      expect(upward(graph, sym), `${sym} 是零引用符号，不该有跨文件调用点`).toEqual([]);
    }
  });

  it("⑤ 预登记 downward 查询集：逐文件 == 真值派生外部定义点", async () => {
    const graph = await buildFixtureGraph();
    for (const file of TRUTH.downwardQueries) {
      const want = TRUTH.edges
        .filter((e) => e.from === file)
        .map((e) => ({ symbol: e.symbol, file: e.to, line: e.defLine }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
      const got = downward(graph, file);
      expect(
        got.map((s) => ({ symbol: s.symbol, file: s.file, line: s.line })),
        `downward(${file}) ≠ 真值（真值 ${want.length} 条出边）`,
      ).toEqual(want);
    }
  });

  it("⑥ 重导出契约：index.ts 的 export…from 不产生定义点（expectedNonEdges 登记）", async () => {
    const graph = await buildFixtureGraph();
    for (const ne of TRUTH.expectedNonEdges) {
      const defs = graph.defs.get(ne.symbol) ?? [];
      expect(
        defs.some((d) => d.file === ne.file),
        `${ne.reason}（实测 ${ne.symbol} 的定义点：${defs.map((d) => d.file + ":" + d.line).join(", ") || "无"}）`,
      ).toBe(false);
    }
    // 且 index.ts 不是哑文件：它在图内、有自己的定义与出边
    expect(graph.files).toContain("index.ts");
    expect(graph.defs.get("summarize")?.some((d) => d.file === "index.ts")).toBe(true);
    expect(graph.edges.some((e) => e.from === "index.ts")).toBe(true);
  });
});
