// 度量台对账面的判卷（M0）。
//
// 为什么这只模块需要判卷：它**不产出能力，只产出"能不能下结论"**。
// 一只判错的尺比没有尺更坏——它会让人拿噪声当改善（本仓 2026-09-30 真实踩过：
// 同一配置跑 4 次，开关两个方向各有一次成败，拿单次成功率当结论是错的）。
//
// 本文件的重点在**两处"不许退化"**上：
//   ① 噪声带不可得 ⇒ 必须判 `unknown`，**不许**退化成"带内"（没量到 ≠ 通过）；
//   ② 任务集不一致 ⇒ 逐指标结论全部作废（分母变了，横比无意义）。
//
// ── 反向验证（本仓要求：关键机制必须能被"拆掉后判卷变红"证明）──
// 把 `compare()` 里这一行
//     const verdict = b === null ? "unknown" : Math.abs(delta) > b ? "beyond-noise" : "within-noise";
// 改成永真（`"within-noise"`），下面这几条必须变红：
//     · "超出噪声带的改善要判 beyond-noise"
//     · "超出噪声带的退化要判 beyond-noise"
//     · "声带不可得时必须判 unknown"
// 反之，把 `sameTaskSet` 的比较改成永远 true，"任务集不一致必须作废"那条必须红。
import { describe, expect, it } from "vitest";
import {
  compare,
  meanTotals,
  noiseBand,
  parseReadings,
  renderReport,
  taskIds,
  totalsOf,
  type Row,
  type Totals,
} from "../scripts/eval/report";

/** 造一份 loop-eval 形状的 readings（`{r, g}[]`）。 */
function readings(rows: Array<Partial<Row> & { id: string }>): string {
  return JSON.stringify(
    rows.map((r) => ({
      r: {
        id: r.id,
        tokensIn: r.tokensIn ?? 1000,
        tokensOut: r.tokensOut ?? 100,
        seconds: r.seconds ?? 10,
        toolFailures: r.toolFailures ?? 0,
        repeatedSameAction: r.repeats ?? 0,
        resources: { rssPeakMb: r.rssPeakMb ?? 100, procPeak: 2, cpuMs: 1, samples: 1 },
      },
      g: { ok: r.ok ?? true, fails: [] },
    })),
  );
}

const T = (o: Partial<Totals>): Totals => ({
  tasks: 2,
  passed: 2,
  successRate: 1,
  tokensIn: 2000,
  tokensOut: 200,
  seconds: 20,
  rssPeakMb: 100,
  toolFailures: 0,
  repeats: 0,
  ...o,
});

describe("parseReadings：口径不对必须出声，不许静默跳过", () => {
  it("认识 loop-eval 写出的形状", () => {
    const rows = parseReadings(readings([{ id: "A" }, { id: "B", ok: false }]));
    expect(rows.map((r) => r.id)).toEqual(["A", "B"]);
    expect(rows[1]?.ok).toBe(false);
  });

  it("不是 JSON ⇒ 抛（带出处标签）", () => {
    expect(() => parseReadings("{ 不是 json", "mydir/readings.json")).toThrow(/mydir\/readings\.json/);
  });

  it("空数组 ⇒ 抛：没有分母不算读数", () => {
    expect(() => parseReadings("[]")).toThrow(/空数组/);
  });

  it("缺 r ⇒ 抛", () => {
    expect(() => parseReadings(JSON.stringify([{ g: { ok: true } }]))).toThrow(/缺 r/);
  });

  it("缺 g.ok ⇒ 抛：没有判卷结果就不该进分母", () => {
    expect(() => parseReadings(JSON.stringify([{ r: { id: "A" }, g: {} }]))).toThrow(/缺 g\.ok/);
  });

  it("数值字段不是数 ⇒ 抛（不静默当 0）", () => {
    const bad = JSON.stringify([
      { r: { id: "A", tokensIn: "很多", tokensOut: 1, seconds: 1, toolFailures: 0, repeatedSameAction: 0 }, g: { ok: true } },
    ]);
    expect(() => parseReadings(bad)).toThrow(/tokensIn/);
  });
});

describe("totalsOf / taskIds：汇总口径", () => {
  it("汇总：成功率按条数、其余求和、内存取峰值", () => {
    const rows = parseReadings(readings([
      { id: "A", tokensIn: 10, tokensOut: 1, seconds: 2, rssPeakMb: 300 },
      { id: "B", ok: false, tokensIn: 20, tokensOut: 2, seconds: 3, rssPeakMb: 150 },
    ]));
    const t = totalsOf(rows);
    expect(t.tasks).toBe(2);
    expect(t.passed).toBe(1);
    expect(t.successRate).toBe(0.5);
    expect(t.tokensIn).toBe(30);
    expect(t.seconds).toBe(5);
    expect(t.rssPeakMb, "内存取峰值不是求和 —— 求和会把并发进程数当内存").toBe(300);
  });

  it("taskIds 去重且排序", () => {
    const rows = parseReadings(readings([{ id: "B" }, { id: "A" }, { id: "B" }]));
    expect(taskIds(rows)).toEqual(["A", "B"]);
  });
});

describe("noiseBand：同配置两次运行的差", () => {
  it("逐指标取绝对差", () => {
    const b = noiseBand(T({ tokensIn: 2000, seconds: 20, successRate: 1 }), T({ tokensIn: 1900, seconds: 25, successRate: 0.5 }));
    expect(b.tokensIn).toBe(100);
    expect(b.seconds).toBe(5);
    expect(b.successRate).toBeCloseTo(0.5, 9);
  });
});

describe("compare：判定与两处「不许退化」", () => {
  it("★ 超出噪声带的改善要判 beyond-noise + better", () => {
    const base = T({ tokensIn: 2000, seconds: 20 });
    const cand = T({ tokensIn: 1200, seconds: 20 });     // 省了 800
    const band = T({ tokensIn: 100, seconds: 5 });        // 噪声只有 100
    const cmp = compare(base, cand, band, ["A", "B"], ["A", "B"]);
    const tin = cmp.lines.find((l) => l.metric === "tokensIn")!;
    expect(tin.verdict).toBe("beyond-noise");
    expect(tin.assessment, "token 变少是改善").toBe("better");
  });

  it("★ 超出噪声带的退化要判 beyond-noise + worse", () => {
    const base = T({ tokensIn: 2000, seconds: 20 });
    const cand = T({ tokensIn: 2600, seconds: 20 });
    const band = T({ tokensIn: 100, seconds: 5 });
    const cmp = compare(base, cand, band, ["A", "B"], ["A", "B"]);
    const tin = cmp.lines.find((l) => l.metric === "tokensIn")!;
    expect(tin.verdict).toBe("beyond-noise");
    expect(tin.assessment).toBe("worse");
  });

  it("改动幅度落在带内 ⇒ 判带内且 assessment=noise（不许当成功）", () => {
    const base = T({ tokensIn: 2000 });
    const cand = T({ tokensIn: 2050 });
    const band = T({ tokensIn: 100 });
    const cmp = compare(base, cand, band, ["A", "B"], ["A", "B"]);
    const tin = cmp.lines.find((l) => l.metric === "tokensIn")!;
    expect(tin.verdict).toBe("within-noise");
    expect(tin.assessment).toBe("noise");
  });

  it("边界：差值恰好等于噪声带 ⇒ 带内（严格大于才算超出）", () => {
    const cmp = compare(T({ tokensIn: 2000 }), T({ tokensIn: 2100 }), T({ tokensIn: 100 }), ["A"], ["A"]);
    expect(cmp.lines.find((l) => l.metric === "tokensIn")!.verdict).toBe("within-noise");
  });

  it("★ 声带不可得时必须判 unknown，**不许退化成带内**（没量到 ≠ 通过）", () => {
    const cmp = compare(T({ tokensIn: 2000 }), T({ tokensIn: 900 }), null, ["A", "B"], ["A", "B"]);
    for (const l of cmp.lines) {
      expect(l.verdict, `${l.metric} 在噪声带不可得时判成了 ${l.verdict}`).toBe("unknown");
      expect(l.assessment).toBe("unknown");
      expect(l.band).toBeNull();
    }
  });

  it("★ 任务集不一致 ⇒ sameTaskSet=false（分母变了，横比无意义）", () => {
    const cmp = compare(T({}), T({}), T({}), ["A", "B"], ["A", "C"]);
    expect(cmp.sameTaskSet).toBe(false);
    const cmp2 = compare(T({}), T({}), T({}), ["A", "B"], ["B", "A"]);
    expect(cmp2.sameTaskSet, "顺序不同也算不一致——排序后逐位比").toBe(false);
    const cmp3 = compare(T({}), T({}), T({}), ["A", "B"], ["A", "B"]);
    expect(cmp3.sameTaskSet).toBe(true);
  });

  it("成功率方向：变高是改善", () => {
    const cmp = compare(T({ successRate: 0.5 }), T({ successRate: 1 }), T({ successRate: 0 }), ["A"], ["A"]);
    const s = cmp.lines.find((l) => l.metric === "successRate")!;
    expect(s.verdict).toBe("beyond-noise");
    expect(s.assessment).toBe("better");
  });
});

describe("renderReport：人看的结论不许说谎", () => {
  it("任务集不一致 ⇒ 明确印「结论全部作废」", () => {
    const cmp = compare(T({}), T({}), T({}), ["A"], ["B"]);
    const txt = renderReport(cmp, "test");
    expect(txt).toContain("任务集不一致");
    expect(txt).toContain("作废");
  });

  it("声带不可得 ⇒ 印「判不出」，不许印成带内", () => {
    const cmp = compare(T({}), T({}), null, ["A"], ["A"]);
    const txt = renderReport(cmp, "不可得");
    expect(txt).toContain("判不出");
    expect(txt).not.toContain("都在噪声带内");
  });

  it("全带内 ⇒ 明说「没有可观测效果」，不许暗示成功", () => {
    const cmp = compare(T({ tokensIn: 2000 }), T({ tokensIn: 2010 }), T({ tokensIn: 100 }), ["A"], ["A"]);
    const txt = renderReport(cmp, "test");
    expect(txt).toContain("没有可观测效果");
  });

  it("有超出项 ⇒ 印出改善/退化各几项", () => {
    const cmp = compare(T({ tokensIn: 2000 }), T({ tokensIn: 1000 }), T({ tokensIn: 100 }), ["A"], ["A"]);
    const txt = renderReport(cmp, "test");
    expect(txt).toContain("超出噪声带");
    expect(txt).toContain("改善 1 项");
  });
});

describe("meanTotals：多份基线取均值", () => {
  it("逐指标平均", () => {
    const m = meanTotals([T({ tokensIn: 1000 }), T({ tokensIn: 3000 })]);
    expect(m.tokensIn).toBe(2000);
  });
  it("空数组 ⇒ 抛", () => {
    expect(() => meanTotals([])).toThrow(/空数组/);
  });
});
