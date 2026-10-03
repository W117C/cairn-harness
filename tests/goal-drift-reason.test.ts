// 目标漂移的**理由面**（第 323 页）。
//
// `goalDriftFindings` 从前只交出 `rule`（`B:quantifier-narrowing` 这样的族 id），而规则表里那句
// 「为什么这一族算漂移」（`why`）没有任何读者——一个字段躺在表里，终端上的人只看到一个缩写 id，
// 想知道含义必须去开源码。这一格本来是「模型可见断言欠证人」清单里的一条，本页不是把它抄进判卷了事，
// 而是把它接进出声的那一半：finding 带 `why`，读数行把理由印出来。
//
// 判卷钉三件事：⑴ 命中那一族时理由要真出现在读数行里；⑵ 三族的理由各不相同（防止"一律交同一句话"）；
// ⑶ 零命中时不许出现理由（空读数后面挂一句解释＝假象有内容）。
import { describe, expect, it } from "vitest";

import { goalDriftCell, goalDriftFindings } from "../src/agent/goal-drift";

describe("goal-drift 的读数要把『为什么算漂移』一起交出", () => {
  it("B 族命中：读数行里要点名「单方面缩小交付面」，不能只留一个族 id", () => {
    const got = goalDriftFindings(["只修 a.ts 就够了，其余的先不管。"]);
    expect(got.map((f) => f.rule)).toContain("B:quantifier-narrowing");
    expect(got[0].why, "finding 自己就得带理由，别只让 cell 拼一份").toContain("单方面缩小交付面");
    expect(goalDriftCell(got)).toContain("单方面缩小交付面");
  });

  it("三族各自的理由互不相同（一律交同一句话＝这条字段是装饰）", () => {
    const got = goalDriftFindings([
      "范围要收窄一点。",
      "只修 a.ts 就够了。",
      "其实我们要的是让导出路径变绿。",
    ]);
    expect(got.map((f) => f.rule).sort()).toEqual(["A:scope-noun-change", "B:quantifier-narrowing", "C:goal-replacement"]);
    for (const f of got) expect(f.why.trim().length, `${f.rule} 的理由是空的`).toBeGreaterThan(0);
    expect(new Set(got.map((f) => f.why)).size, "三族同一句话＝理由没有分辨力").toBe(3);
  });

  it("零命中时读数保持那句短陈述，不许在空读数后面挂理由", () => {
    const got = goalDriftFindings(["我在按原计划推进，先读 README。"]);
    expect(got).toEqual([]);
    expect(goalDriftCell(got)).toBe("目标漂移 0 处");
    expect(goalDriftCell(got)).not.toContain("——");
  });
});
