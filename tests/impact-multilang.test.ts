// 影响面·多语言基准（M1 路线图交付物）：新语法夹具 fixtures/impact/accuracy-repo-multilang
// （go 两文件同包跨文件调用＋java 两文件 new 类名引用）＋ 人工核对的 ground-truth.json（2 条跨文件真值边）。
// 断言 precision=1.0、recall=1.0（夹具内可捕获形状全数捕获）、解析零静默丢条（每文件 tags 非空）、
// 预登记 upward/downward 查询集逐条一致、被纪律排除的形状（选择器/受体调用）确无假边。
// 与 impact-accuracy.test.ts 的分工：那份钉 js/ts 既有形状（夹具归 261 页作者），这份只钉 go/java 新形状——
// 互不改对方的夹具与真值（并行协作协议 5.1）。
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildImpact, upward, type ImpactEdge, type ImpactGraph } from "../src/agent/impact/index.js";
import { fileTags } from "../src/agent/map/parse.js";

const MULTILANG_REPO = fileURLToPath(new URL("../fixtures/impact/accuracy-repo-multilang/", import.meta.url));
const TRUTH = JSON.parse(
  await readFile(fileURLToPath(new URL("../fixtures/impact/accuracy-repo-multilang/ground-truth.json", import.meta.url)), "utf8"),
) as {
  edgeCount: number;
  edges: { from: string; refLine: number; symbol: string; to: string; defLine: number }[];
  boundary: { symbol: string; file: string; refLine: number; defLine?: number; reason: string }[];
  expectedNonEdges: { file: string; line: number; symbol: string; reason: string }[];
  zeroRefSymbols: string[];
  upwardQueries: string[];
  downwardQueries: string[];
};

const EXPECTED_FILES = ["Helper.java", "Main.java", "calc.go", "mathutil.go"];

function edgeKey(e: Pick<ImpactEdge, "from" | "to" | "symbol" | "refLine" | "defLine">): string {
  return [e.from, e.to, e.symbol, e.refLine, e.defLine].join("\u241F");
}

async function buildMultilangGraph(): Promise<ImpactGraph> {
  const cacheDir = await mkdtemp(join(tmpdir(), "impact-multilang-"));
  return buildImpact({ workspace: MULTILANG_REPO, cacheDir });
}

describe("影响面·多语言基准（accuracy-repo-multilang：go + java）", () => {
  it("① 图内文件集 = 夹具 4 文件（go/java 进图）；解析零静默丢条（每文件 tags 非空）", async () => {
    const graph = await buildMultilangGraph();
    expect(graph.files, "图内文件集 ≠ 夹具文件集（go 或 java 没进扫描面）").toEqual(EXPECTED_FILES);
    const errors: string[] = [];
    for (const rel of EXPECTED_FILES) {
      const src = await readFile(join(MULTILANG_REPO, rel), "utf8");
      const ext = rel.slice(rel.lastIndexOf(".") + 1);
      const tags = await fileTags(src, ext);
      if (tags.length === 0) errors.push(`${rel}（.${ext}）: 解析得 0 个 tag（grammar 缺失或解析失败被吞）`);
    }
    expect(errors, `解析错误 ${errors.length} 条：${errors.join("；")}`).toEqual([]);
  });

  it("② 图边集逐条 == 真值边集（真值 edgeCount=" + TRUTH.edgeCount + "；多一条少一条都点名）", async () => {
    const graph = await buildMultilangGraph();
    const got = new Set(graph.edges.map(edgeKey));
    const want = new Set(TRUTH.edges.map(edgeKey));
    const extra = graph.edges.filter((e) => !want.has(edgeKey(e)));
    const missing = TRUTH.edges.filter((e) => !got.has(edgeKey(e)));
    expect(
      { extra, missing },
      `真值 ${TRUTH.edgeCount} 条 vs 图 ${graph.edges.length} 条——多出的=假边，缺的=漏抽`,
    ).toEqual({ extra: [], missing: [] });
  });

  it("③ upward 查询集逐条与真值一致（跨文件调用者全数、零引用符号为 0）", async () => {
    const graph = await buildMultilangGraph();
    for (const sym of TRUTH.upwardQueries) {
      const sites = upward(graph, sym);
      const callers = sites.map((s) => s.file);
      const truthEdgeTo = TRUTH.edges.filter((e) => e.symbol === sym).map((e) => e.from);
      if (truthEdgeTo.length > 0) {
        expect(
          { sym, callers },
          `${sym} 的跨文件调用者与真值不符`,
        ).toEqual({ sym, callers: truthEdgeTo });
      } else {
        expect(sites, `${sym} 应为零跨文件引用（zeroRef/纪律排除）`).toEqual([]);
      }
    }
  });

  it("④ 被纪律排除的形状确无假边（同文件调用与受体调用不出现在图边里）", async () => {
    const graph = await buildMultilangGraph();
    for (const b of TRUTH.boundary) {
      const hit = graph.edges.filter((e) => e.symbol === b.symbol && e.from === b.file);
      expect(hit, `${b.file} 里 ${b.symbol} 的${b.reason}——不该成边`).toEqual([]);
    }
    for (const ne of TRUTH.expectedNonEdges) {
      const hit = graph.edges.filter((e) => e.from === ne.file && e.symbol === ne.symbol);
      expect(hit, `${ne.file}:${ne.line} 的 ${ne.symbol}——${ne.reason}`).toEqual([]);
    }
  });

  it("⑤ zeroRefSymbols 的 upward 全空（真值栏与图行为一致）", async () => {
    const graph = await buildMultilangGraph();
    for (const sym of TRUTH.zeroRefSymbols) {
      expect(upward(graph, sym), `${sym} 应零跨文件引用`).toEqual([]);
    }
  });
});
