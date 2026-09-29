// M2b 任务 2 验收（图与排名）：边权随 num_refs 单调；personalization 让被提及的标识符排名上升；
// 收敛判定有效（两次迭代差 < 阈值即停）。
import { describe, expect, it } from "vitest";
import { buildGraph, personalizedPageRank, edgeWeight, rankedNodes, type FileTagsInput } from "../src/agent/map/rank.js";
import type { SymbolTag } from "../src/agent/map/parse.js";

function file(file: string, pairs: [string, "def" | "ref", number][]): FileTagsInput {
  return { file, tags: pairs.map(([name, kind, line]) => ({ name, kind, line }) as SymbolTag) };
}

describe("map rank（任务 2）", () => {
  it("边权随 num_refs 单调（同 mul 下 √num_refs 递增）", () => {
    const one = buildGraph([
      file("a.ts", [["get", "def", 1], ["get", "ref", 2]]),
      file("b.ts", [["get", "ref", 1]]),
    ]);
    const twice = buildGraph([
      file("a.ts", [["get", "def", 1], ["get", "ref", 2], ["get", "ref", 3], ["get", "ref", 4]]),
      file("b.ts", [["get", "ref", 1], ["get", "ref", 2], ["get", "ref", 3], ["get", "ref", 4]]),
    ]);
    const w1 = edgeWeight(one, "b.ts", "get", "a.ts");
    const w2 = edgeWeight(twice, "b.ts", "get", "a.ts");
    // b.ts 里 get 出现 1 次（√1） vs 4 次（√4=2）——其余 mul 相同
    expect(w2).toBeCloseTo(w1 * 2, 8);
    // 单调性：出现更多次的边权严格更大
    expect(w2).toBeGreaterThan(w1);
  });

  it("personalization 让被提及的标识符排名上升；上下文文件加权同向", () => {
    const files = [
      file("a.ts", [["ordinary", "def", 1], ["called", "def", 2]]),
      file("b.ts", [["ordinary", "ref", 1], ["called", "ref", 2]]),
    ];
    const plain = buildGraph(files);
    const plainRanks = personalizedPageRank(plain);
    const plainIdx = new Map(plain.nodes.map((n, i) => [n.kind + ":" + n.file + ":" + n.name, plainRanks[i]]));
    const boosted = buildGraph(files, { mentionedIdents: ["called"], contextFiles: ["b.ts"] });
    const boostedRanks = personalizedPageRank(boosted);
    const boostedIdx = new Map(boosted.nodes.map((n, i) => [n.kind + ":" + n.file + ":" + n.name, boostedRanks[i]]));
    // 同为 def 节点：被提及的 called 排名上升，ordinary 相对下降
    expect(boostedIdx.get("def:a.ts:called")!).toBeGreaterThan(plainIdx.get("def:a.ts:called")!);
    expect(boostedIdx.get("def:a.ts:ordinary")!).toBeLessThan(plainIdx.get("def:a.ts:ordinary")!);
  });

  it("收敛判定有效（两次迭代差 < 阈值即停；迭代数远小于上限且结果稳定）", () => {
    const files = [
      file("a.ts", [["alpha", "def", 1], ["alpha", "ref", 2], ["gamma", "def", 3]]),
      file("b.ts", [["alpha", "ref", 1], ["gamma", "ref", 2]]),
      file("c.ts", [["alpha", "ref", 1]]),
    ];
    let iters = -1;
    const g = buildGraph(files);
    const ranks = personalizedPageRank(g, { eps: 1e-8, maxIterations: 1000, onIterations: (n) => (iters = n) });
    expect(iters).toBeGreaterThan(0);
    expect(iters).toBeLessThan(100); // 没撞上限，阈值提前停
    // 相同输入跑两次结果逐字一致（确定性）
    const again = personalizedPageRank(buildGraph(files), { eps: 1e-8, maxIterations: 1000 });
    expect(again).toEqual(ranks);
    // 阈值放宽 → 更早停
    let looseIters = -1;
    personalizedPageRank(buildGraph(files), { eps: 1e-2, maxIterations: 1000, onIterations: (n) => (looseIters = n) });
    expect(looseIters).toBeLessThanOrEqual(iters);
  });

  it("mul 规则：mentioned ×10 / 上下文文件 ×50 / 长名 ×10 / 下划线 ×0.1 / 定义点>5 ×0.1", () => {
    const defs = file("d.ts", [["get", "def", 1]]);
    const base = buildGraph([defs, file("r.ts", [["get", "ref", 1]])]);
    const wBase = edgeWeight(base, "r.ts", "get", "d.ts");
    const mentioned = buildGraph(
      [defs, file("r.ts", [["get", "ref", 1]])],
      { mentionedIdents: ["get"] },
    );
    expect(edgeWeight(mentioned, "r.ts", "get", "d.ts")).toBeCloseTo(wBase * 10, 8);
    const ctx = buildGraph(
      [defs, file("r.ts", [["get", "ref", 1]])],
      { contextFiles: ["r.ts"] },
    );
    expect(edgeWeight(ctx, "r.ts", "get", "d.ts")).toBeCloseTo(wBase * 50, 8);
    const longName = buildGraph([file("d.ts", [["fetch_data", "def", 1]]), file("r.ts", [["fetch_data", "ref", 1]])]);
    const wLong = edgeWeight(longName, "r.ts", "fetch_data", "d.ts");
    // fetch_data(10 字符) ×10；对照 short ident（3 字符）无长度加成
    expect(wLong).toBeCloseTo(wBase * 10, 8);
    const short = buildGraph([file("d.ts", [["xyz", "def", 1]]), file("r.ts", [["xyz", "ref", 1]])]);
    expect(edgeWeight(short, "r.ts", "xyz", "d.ts")).toBeCloseTo(wBase, 8);
    const under = buildGraph([file("d.ts", [["_p", "def", 1]]), file("r.ts", [["_p", "ref", 1]])]);
    expect(edgeWeight(under, "r.ts", "_p", "d.ts")).toBeCloseTo(wBase * 0.1, 8);
    const many = buildGraph([
      file("d0.ts", [["get", "def", 1]]),
      file("d1.ts", [["get", "def", 1]]),
      file("d2.ts", [["get", "def", 1]]),
      file("d3.ts", [["get", "def", 1]]),
      file("d4.ts", [["get", "def", 1]]),
      file("d5.ts", [["get", "def", 1]]),
      file("r.ts", [["get", "ref", 1]]),
    ]);
    const wGet = edgeWeight(many, "r.ts", "get", "d0.ts");
    const wPlain = edgeWeight(many, "r.ts", "get", "d1.ts");
    void wPlain;
    // 6 个定义点 > 5 → ×0.1
    expect(wGet).toBeGreaterThan(0);
    const fewer = buildGraph([
      file("d0.ts", [["get", "def", 1]]),
      file("r.ts", [["get", "ref", 1]]),
    ]);
    expect(wGet).toBeCloseTo(edgeWeight(fewer, "r.ts", "get", "d0.ts") * 0.1, 8);
  });

  it("def-only 节点自环 0.1；空图返回空排名", () => {
    const g = buildGraph([file("a.ts", [["lonely", "def", 1]])]);
    const k = "def\u0000a.ts\u0000lonely";
    expect(g.adj.get(k)?.get(k)).toBe(0.1);
    expect(personalizedPageRank(buildGraph([]))).toEqual([]);
    expect(rankedNodes(g, personalizedPageRank(g))[0].name).toBe("lonely");
  });

  it("同分节点按 file→name→kind 升序，而不是按插入序", () => {
    // 两个互不引用的同形文件：PageRank 必然给**完全相同**的值 ⇒ 只比分数时，次序由 g.nodes 的插入序决定。
    // 这里刻意**倒着插**（z 在前、a 在后）：认插入序的写法会把 z 排在前面，这条断言就是只有次级键才看得见的形状。
    const g = buildGraph([
      file("z.ts", [["same", "def", 1]]),
      file("a.ts", [["same", "def", 1]]),
    ]);
    const ranked = rankedNodes(g, personalizedPageRank(g));
    expect(ranked).toHaveLength(2);
    expect(ranked.map((n) => n.file)).toEqual(["a.ts", "z.ts"]);
  });
});
