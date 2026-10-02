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
// **2026-10-01 实跑过，不是照本宣科**：
//
//  ① 把 `compare()` 里这一行
//         const verdict = b === null ? "unknown" : Math.abs(delta) > b ? "beyond-noise" : "within-noise";
//     改成恒 `"within-noise"`（即"永不判超出"）⇒ **6 条判卷立刻红**：
//         × 超出噪声带的改善要判 beyond-noise + better
//         × 超出噪声带的退化要判 beyond-noise + worse
//         × 声带不可得时必须判 unknown，不许退化成带内
//         × 成功率方向：变高是改善
//         × 声带不可得 ⇒ 印「判不出」，不许印成带内
//         × 有超出项 ⇒ 印出改善/退化各几项
//     还原后 22/22 绿。
//  ② 把 `sameTaskSet` 改成恒 `true`（拆掉"分母一致"护栏）⇒ **2 条判卷红**：
//         × 任务集不一致 ⇒ sameTaskSet=false（分母变了，横比无意义）
//         × 任务集不一致 ⇒ 明确印「结论全部作废」
//     还原后 22/22 绿，`git diff` 确认与提交版逐字一致（没留下改坏的东西）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compare,
  meanTotals,
  modelFace,
  noiseBand,
  parseReadings,
  renderModelFace,
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
        ...(r.model !== undefined ? { model: r.model } : {}),
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

// 归因面（2026-10-02 补）。为什么这条比"再一个字段"要紧：基准跑器从前绕过 `createUsageAttributor`，
// 行内没有模型名 ⇒ 拿"换了档位的两次跑"当"同一档位下改了提示词"来读，差值整个归错对象。
// 本仓 09-26 已有一次跨臂池化的教训（九条臂的读数不能横着比），那条是散文，这一条是闸。
describe("模型归因面：跨模型的差值不许当改动的效果", () => {
  const r = (model: string, over: Partial<Row> = {}): Row => ({
    id: "A", model, tokensIn: 1000, tokensOut: 100, seconds: 10,
    rssPeakMb: 100, toolFailures: 0, repeats: 0, ok: true, ...over,
  });

  it("两臂同一档 ⇒ same（没有东西被挡时也要印出是哪一档）", () => {
    const f = modelFace([r("glm-5.2"), r("glm-5.2")], [r("glm-5.2")]);
    expect(f.state).toBe("same");
    expect(renderModelFace(f)).toContain("glm-5.2");
  });

  it("两臂不同档 ⇒ differs，且渲染里点名两侧各自的档", () => {
    const f = modelFace([r("glm-5.2")], [r("glm-5.3-flash")]);
    expect(f.state).toBe("differs");
    const txt = renderModelFace(f);
    expect(txt).toContain("glm-5.2");
    expect(txt).toContain("glm-5.3-flash");
    expect(txt).not.toContain("同一档");
  });

  it("同一臂内混了档 ⇒ 也是 differs（那连「同配置两次」这个噪声带前提都不成立）", () => {
    expect(modelFace([r("glm-5.2"), r("glm-5.3-flash")], [r("glm-5.2")]).state).toBe("differs");
  });

  it("★缺归因键 ⇒ unknown，不许退化成 same（取不到＝未证，不是通过）", () => {
    const f = modelFace([r("")], [r("glm-5.2")]);
    expect(f.state).toBe("unknown");
    expect(f.state).not.toBe("same");
    expect(renderModelFace(f)).toContain("判不出");
    // 两侧都缺也还是 unknown，不是"大家一样 ⇒ 算同面"
    expect(modelFace([r("")], [r("")]).state).toBe("unknown");
  });

  it("parseReadings：行内没有 model 键 ⇒ 空串而不是抛（存量语料仍然读得动）", () => {
    const rows = parseReadings(readings([{ id: "A" }]));
    expect(rows[0]?.model).toBe("");
    expect(modelFace(rows, rows).state).toBe("unknown");
    // 同一份文本带上键之后就换档：证明这条走的是真解析，不是写死的空串
    const withModel = parseReadings(readings([{ id: "A", model: "glm-5.2" }]));
    expect(withModel[0]?.model).toBe("glm-5.2");
    expect(modelFace(withModel, withModel).state).toBe("same");
  });

  it("接线：CLI 把归因面打在表之前，且吃的是**全部**基线文件而不是第一份", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/eval/report.ts", import.meta.url)), "utf8");
    // 先钉"印出来了"：只比先后顺序的话，把这一行整个删掉反而仍成立（-1 < X）＝空尺
    expect(src, "算出来却不印 ⇒ 与没算同形").toContain("process.stdout.write(renderModelFace(face)");
    const face = src.indexOf("modelFace(baseRows.flat(), candRows.flat())");
    expect(face, "跑器没把两侧所有行交给归因面 ⇒ 同一臂内混档就看不见").toBeGreaterThan(-1);
    expect(src.indexOf("renderModelFace(face)")).toBeLessThan(src.indexOf("renderReport(cmp, bandSource)"));
  });
});
