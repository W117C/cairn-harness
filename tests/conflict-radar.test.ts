// 并行 worker 语义冲突雷达的内核判卷（第 1074 页）：纯函数，喂手搓 ImpactGraph，不建图不读盘。
// 三条口径各钉一格：hunk 行区间解析、行区间 × 站点行号求交、v1 只让 same-symbol 拦合并（cross-consumer 只告警）。
import { describe, expect, it } from "vitest";
import {
  parseHunks,
  radarConflicts,
  radarGateVerdict,
  radarNote,
  symbolsAtLines,
  symbolsTouched,
  type WorkerTouch,
} from "../src/agent/conflict-radar";
import type { ImpactGraph } from "../src/agent/impact/index";

function graphOf(
  defs: Record<string, readonly (readonly [string, number])[]>,
  refs: Record<string, readonly (readonly [string, number])[]> = {},
): ImpactGraph {
  const sites = (symbol: string, list: readonly (readonly [string, number])[]) =>
    list.map(([file, line]) => ({ symbol, file, line }));
  return {
    files: [...new Set([...Object.values(defs), ...Object.values(refs)].flatMap((l) => l.map(([f]) => f)))].sort(),
    candidates: 0,
    cap: 0,
    defs: new Map(Object.entries(defs).map(([s, l]) => [s, sites(s, l)])),
    refs: new Map(Object.entries(refs).map(([s, l]) => [s, sites(s, l)])),
    edges: [],
    nameSources: new Map(), // 没有 import 面 ⇒ upward 的归属判据按 no-evidence 保守计入（kept）
    attribution: { kept: 0, dropped: 0, noEvidence: 0 },
    parsed: 0,
    fromTagsCache: 0,
  };
}

const touch = (agentId: string, files: string[], hunks?: [string, number, number][]): WorkerTouch => ({
  agentId,
  files,
  ...(hunks !== undefined
    ? { hunks: new Map(hunks.map(([f, start, end]) => [f, [{ start, end }]])) }
    : {}),
});

describe("parseHunks：unified diff 的新文件侧行区间", () => {
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,0 +2,3 @@",
    "+a",
    "+b",
    "+c",
    "diff --git a/src/b.ts b/src/b.ts",
    "--- a/src/b.ts",
    "+++ b/src/b.ts",
    "@@ -10 +12 @@",
    "-old",
    "+new",
    "@@ -20,3 +22,0 @@",
    "-x",
  ].join("\n");

  it("多文件分块、省略计数（+c 视为 1 行）、纯删除（+c,0 记成 [c,c]）", () => {
    const hunks = parseHunks(patch);
    expect([...hunks.keys()]).toEqual(["src/a.ts", "src/b.ts"]);
    expect(hunks.get("src/a.ts")).toEqual([{ start: 2, end: 4 }]);
    expect(hunks.get("src/b.ts")).toEqual([{ start: 12, end: 12 }, { start: 22, end: 22 }]);
  });

  it("删除 /dev/null 与二进制块不产出行区间（没有新文件侧可求交）", () => {
    const del = [
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-a",
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
    ].join("\n");
    expect([...parseHunks(del).keys()]).toEqual([]);
  });
});

describe("symbolsAtLines / symbolsTouched：行区间 × 站点行号求交", () => {
  const g = graphOf({
    foo: [["src/a.ts", 5]],
    bar: [["src/a.ts", 40]],
    baz: [["src/b.ts", 7]],
  });

  it("给了行区间就只算落在区间里的符号；缺省整文件", () => {
    expect(symbolsAtLines(g, "src/a.ts", [{ start: 1, end: 20 }])).toEqual(["foo"]);
    expect(symbolsAtLines(g, "src/a.ts")).toEqual(["bar", "foo"]);
    expect(symbolsAtLines(g, "src/zzz.ts")).toEqual([]);
  });

  it("有 hunk 的一侧按行求交，没 hunk 的一侧按整文件（宁多勿漏口径）", () => {
    const withHunks = symbolsTouched(g, touch("a", ["src/a.ts"], [["src/a.ts", 30, 50]]));
    expect([...withHunks.keys()]).toEqual(["bar"]);
    const wholeFile = symbolsTouched(g, touch("b", ["src/a.ts"]));
    expect([...wholeFile.keys()].sort()).toEqual(["bar", "foo"]);
  });
});

describe("radarConflicts：same-symbol / cross-consumer / 无关", () => {
  const g = graphOf(
    { foo: [["src/a.ts", 5]], parse: [["src/utils.ts", 2]] },
    { parse: [["src/app.ts", 17]] },
  );

  it("两侧都改到同一个符号的 def ⇒ same-symbol（带双方文件与行号）", () => {
    const out = radarConflicts(g, touch("w-1", ["src/a.ts"]), [touch("w-2", ["src/a.ts"])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("same-symbol");
    expect(out[0]!.symbol).toBe("foo");
    expect(out[0]!.mine).toEqual({ agentId: "w-1", file: "src/a.ts", line: 5 });
    expect(out[0]!.theirs).toEqual({ agentId: "w-2", file: "src/a.ts", line: 5 });
  });

  it("我方改的 def 被对方改动面里的文件消费 ⇒ cross-consumer（方向：我改、它用）", () => {
    const out = radarConflicts(g, touch("w-1", ["src/utils.ts"]), [touch("w-2", ["src/app.ts"])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("cross-consumer");
    expect(out[0]!.symbol).toBe("parse");
    expect(out[0]!.theirs).toEqual({ agentId: "w-2", file: "src/app.ts", line: 17 });
  });

  it("行区间不碰站点 ⇒ 不算冲突；别人的 agentId 不与自己比；空改动面返回空", () => {
    expect(radarConflicts(g, touch("w-1", ["src/a.ts"], [["src/a.ts", 100, 120]]), [touch("w-2", ["src/a.ts"])])).toEqual([]);
    expect(radarConflicts(g, touch("w-1", ["src/a.ts"]), [touch("w-1", ["src/a.ts"])])).toEqual([]);
    expect(radarConflicts(g, touch("w-1", []), [touch("w-2", ["src/a.ts"])])).toEqual([]);
  });

  it("同一符号两侧都改时只报 same-symbol，不再叠一条 cross-consumer", () => {
    const gg = graphOf({ foo: [["src/a.ts", 5]] }, { foo: [["src/b.ts", 9]] });
    const out = radarConflicts(gg, touch("w-1", ["src/a.ts"]), [touch("w-2", ["src/a.ts", "src/b.ts"])]);
    expect(out.map((c) => c.kind)).toEqual(["same-symbol"]);
  });

  it("每对 ≤6 条（RADAR_PAIR_LIMIT），排序确定性：same-symbol 在前、按符号名", () => {
    const defs: Record<string, readonly (readonly [string, number])[]> = {};
    for (let i = 0; i < 8; i++) defs["sym" + String(i)] = [["src/a.ts", i + 1]];
    const gg = graphOf(defs);
    const out = radarConflicts(gg, touch("w-1", ["src/a.ts"]), [touch("w-2", ["src/a.ts"])]);
    expect(out).toHaveLength(6);
    expect(out.map((c) => c.symbol)).toEqual(["sym0", "sym1", "sym2", "sym3", "sym4", "sym5"]);
  });
});

describe("radarGateVerdict / radarNote", () => {
  const g = graphOf({ foo: [["src/a.ts", 5]] }, { bar: [["src/a.ts", 9]] });
  const same = radarConflicts(g, touch("w-1", ["src/a.ts"]), [touch("w-2", ["src/a.ts"])]);

  it("v1 只拦 same-symbol；force 可过；cross-consumer 不参与拦截", () => {
    expect(radarGateVerdict(same).allow).toBe(false);
    expect(radarGateVerdict(same, { force: true }).allow).toBe(true);
    expect(radarGateVerdict(same, { force: true }).blocking).toHaveLength(1);
    const cross = same.map((c) => ({ ...c, kind: "cross-consumer" as const }));
    expect(radarGateVerdict(cross).allow).toBe(true);
  });

  it("归因文案带方向、符号与两侧 file:line", () => {
    const note = radarNote(same);
    expect(note).toContain("w-1 改 `foo`（src/a.ts:5）");
    expect(note).toContain("w-2 也在改它（src/a.ts:5）");
  });
});
