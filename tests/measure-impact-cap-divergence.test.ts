// 量尺判卷 · `scripts/measure-impact-cap-divergence.ts` 的纯函数那一半。
//
// 为什么要给一把尺配用例：`#32`（影响面默认帽要不要抬）是一条裁决，裁决依据就是这个数。
// 数错方向的后果不对称——把"有分歧"数成"零分歧"会让人裁"不用动"，而那条"零分歧"的句子
// 看起来比任何别的句子都省心。所以这里钉的是**偏保守的那一侧**：
// 只要全量图多给出一个波及文件，就必须算成分歧；顺序/重复都不许让它变小。
import { describe, expect, it } from "vitest";
import type { ImpactGraph, ImpactSite } from "../src/agent/impact";
import { confirmedExtraOf, tallyDivergence, type AnswerPair } from "../scripts/measure-impact-cap-divergence";

const pair = (file: string, capped: string[], full: string[]): AnswerPair => ({ file, capped, full });

describe("两图答案差集：漏一个就要出声", () => {
  it("两边逐字相同 ⇒ 零分歧（这一格是「不值得动」那条句子的前提，必须是真判出来的）", () => {
    const t = tallyDivergence([pair("a.ts", ["b.ts", "c.ts"], ["b.ts", "c.ts"]), pair("d.ts", [], [])]);
    expect(t.divergent).toBe(0);
    expect(t.missedFiles).toBe(0);
    expect(t.worst).toBeNull();
    expect(t.comparable).toBe(2);
  });

  it("全量图多一个波及文件 ⇒ 算分歧，且 worst 指到那一条", () => {
    const t = tallyDivergence([pair("a.ts", ["b.ts"], ["b.ts", "z.ts"])]);
    expect(t.divergent).toBe(1);
    expect(t.missedFiles).toBe(1);
    expect(t.worst).toEqual({ file: "a.ts", extra: ["z.ts"] });
  });

  it("capped 里多出来的不算漏（方向钉死：只数 full \\ capped，反向漂动不许混进这一格）", () => {
    expect(tallyDivergence([pair("a.ts", ["b.ts", "ghost.ts"], ["b.ts"])]).divergent).toBe(0);
  });

  it("重复与顺序都不改变结论（full 里同一文件出现两次 = 只漏一个文件）", () => {
    const t = tallyDivergence([pair("a.ts", [], ["z.ts", "z.ts", "y.ts"])]);
    expect(t.missedFiles).toBe(2);
    expect(t.worst?.extra).toEqual(["y.ts", "z.ts"]);
  });

  it("worst 取漏得最多的那一条，而不是第一条（读数要能指出最贵的例子）", () => {
    const t = tallyDivergence([
      pair("small.ts", [], ["x.ts"]),
      pair("big.ts", [], ["p.ts", "q.ts", "r.ts"]),
    ]);
    expect(t.worst?.file).toBe("big.ts");
    expect(t.missedFiles).toBe(4);
  });

  it("确证漏报单独计一笔：上界（分歧）与下界（确证）各算各的，不许互相顶替", () => {
    const t = tallyDivergence([
      pair("a.ts", [], ["x.ts", "y.ts"]), // 只有上界：可能是撞名多报
      { file: "b.ts", capped: [], full: ["z.ts"], confirmedExtra: ["z.ts"] },
      { file: "c.ts", capped: [], full: ["w.ts"], confirmedExtra: ["w.ts", "w.ts"] }, // 重复只算一次
    ]);
    expect(t.divergent).toBe(3);
    expect(t.confirmedQueries).toBe(2);
    expect(t.confirmedSites).toBe(2);
  });

  it("没有 confirmedExtra 时确证两格为 0，而不是 undefined（缺省≠没数）", () => {
    const t = tallyDivergence([pair("a.ts", [], ["x.ts"])]);
    expect(t.confirmedQueries).toBe(0);
    expect(t.confirmedSites).toBe(0);
  });
});

const site = (file: string, symbol: string, line = 1): ImpactSite => ({ file, line, symbol }) as ImpactSite;
const graph = (files: string[], defs: Record<string, ImpactSite[]>, refs: Record<string, ImpactSite[]>): ImpactGraph =>
  ({ files, candidates: files.length, cap: files.length, defs: new Map(Object.entries(defs)), refs: new Map(Object.entries(refs)), edges: [], nameSources: new Map(), attribution: { kept: 0, dropped: 0, noEvidence: 0 }, parsed: 0, fromTagsCache: 0 }) as ImpactGraph;

describe("确证漏报只认全仓唯一的符号（下界不能被撞名多报撑大）", () => {
  const full1 = graph(
    ["a.ts", "x.ts"],
    { uniq: [site("a.ts", "uniq")] },
    { uniq: [site("a.ts", "uniq"), site("x.ts", "uniq")] },
  );

  it("符号唯一、定义在被查文件里、调用点在帽外那批 ⇒ 算一处确证漏报", () => {
    const capped = graph(["a.ts"], { uniq: [site("a.ts", "uniq")] }, { uniq: [site("a.ts", "uniq")] });
    expect(confirmedExtraOf(capped, full1, "a.ts")).toEqual(["x.ts"]);
  });

  it("同名符号在别处也有定义 ⇒ 不算确证（启发式图会把 `test` 这种名字跨文件合并）", () => {
    const dupFull = graph(
      ["a.ts", "o.ts", "x.ts"],
      { dup: [site("a.ts", "dup"), site("o.ts", "dup")] },
      { dup: [site("x.ts", "dup")] },
    );
    const capped = graph(["a.ts", "o.ts"], { dup: [site("a.ts", "dup"), site("o.ts", "dup")] }, { dup: [site("o.ts", "dup")] });
    expect(confirmedExtraOf(capped, dupFull, "a.ts")).toEqual([]);
  });

  it("调用点在缺省帽**已收录**的文件里 ⇒ 不是帽造成的，不计", () => {
    const full2 = graph(
      ["a.ts", "b.ts"],
      { uniq: [site("a.ts", "uniq")] },
      { uniq: [site("b.ts", "uniq")] },
    );
    const capped = graph(["a.ts", "b.ts"], { uniq: [site("a.ts", "uniq")] }, { uniq: [site("b.ts", "uniq")] });
    expect(confirmedExtraOf(capped, full2, "a.ts")).toEqual([]);
  });
});
