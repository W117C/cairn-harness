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
  exitCodeOf,
  GATE_SENTENCE,
  IDENTITY_SENTENCE,
  identityOf,
  meanTotals,
  modelFace,
  noiseBand,
  outcomeGate,
  parseReadings,
  renderExitFace,
  renderIdentityFace,
  renderModelFace,
  renderReport,
  taskIds,
  totalsOf,
  type Comparison,
  type IdentityRuling,
  type OutcomeRuling,
  type Row,
  type Totals,
} from "../scripts/eval/report";

/** 造一份 loop-eval 形状的 readings（`{r, g}[]`）。身份键（headSha／ranAt／model）**只在上游显式给了
 *  才写进去**——不给就是"存量语料"那一档，身份闸必须咬。 */
function readings(rows: Array<Partial<Row> & { id: string }>): string {
  return JSON.stringify(
    rows.map((r) => ({
      r: {
        id: r.id,
        ...(r.model !== undefined ? { model: r.model } : {}),
        ...(r.headSha !== undefined ? { headSha: r.headSha } : {}),
        ...(r.ranAt !== undefined ? { ranAt: r.ranAt } : {}),
        // #90 的逐靶配对键：给了才盖章，`rep`/`maxSteps`/`reps` 走数值、`arm` 走字符串（同 parseReadings 的取值口径）。
        ...(r.rep !== undefined ? { rep: r.rep } : {}),
        ...(r.maxSteps !== undefined ? { maxSteps: r.maxSteps } : {}),
        ...(r.reps !== undefined ? { reps: r.reps } : {}),
        ...(r.arm !== undefined ? { arm: r.arm } : {}),
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
    id: "A", model, headSha: "1111111", ranAt: "2026-10-05T00:00:00Z",
    tokensIn: 1000, tokensOut: 100, seconds: 10,
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

// ── 合取闸（2026-10-05 补）────────────────────────────────────────────────────────
// 为什么这道闸比"再一个判定"要紧：**逐指标各判各的**正是这张表唯一的误读面。
// 2026-10-05 离线实跑（基线 outputs/eval-base-a ↔ eval-base-b 同配置两次、候选
// outputs/bench-reps3-2026-10-02）：5 项超带 = 3 项 ★改善（输入 token／输出 token／墙钟）
// ＋ 2 项退化，其中成功率 70.8% ⇒ 5.6%。一次跑废了，表把它印成"改动有效"。
// 判据建在**指标语义**（方向表里"越大越好"那一侧＝结果类）上，不建在指标名的字符串匹配上。
describe("跨指标合取闸：结果类超带退化 ⇒ 整表禁止读作改善", () => {
  const band = T({ successRate: 0.09, passed: 1, tokensIn: 100, tokensOut: 10, seconds: 2 });

  /** 合成态①：成功率崩了，成本同时"降"——就是实跑那次反转的形状。 */
  const collapsed: Comparison = compare(
    T({ successRate: 0.75, passed: 9, tokensIn: 2000, tokensOut: 200, seconds: 20 }),
    T({ successRate: 0.083, passed: 1, tokensIn: 1200, tokensOut: 120, seconds: 12 }),
    band, ["A", "B"], ["A", "B"],
  );
  /** 合成态②：成功率同档（差在带内），成本同样"降"——闸**不该**咬。 */
  const flatOutcome = compare(
    T({ successRate: 0.5, passed: 6, tokensIn: 2000, tokensOut: 200, seconds: 20 }),
    T({ successRate: 0.55, passed: 6, tokensIn: 1200, tokensOut: 120, seconds: 12 }),
    band, ["A", "B"], ["A", "B"],
  );
  /** 合成态③：成功率超带改善，成本同样"降"——照旧允许改善。 */
  const betterOutcome = compare(
    T({ successRate: 0.5, passed: 6, tokensIn: 2000, tokensOut: 200, seconds: 20 }),
    T({ successRate: 0.75, passed: 9, tokensIn: 1200, tokensOut: 120, seconds: 12 }),
    band, ["A", "B"], ["A", "B"],
  );

  it("合成态① ⇒ blocked=true，退化项与被关闭的改善项都点得出名字", () => {
    const g = outcomeGate(collapsed);
    expect(g.blocked).toBe(true);
    expect(g.degraded).toEqual(["successRate", "passed"]);
    expect(g.suppressed).toEqual(["tokensIn", "tokensOut", "seconds"]);
  });

  it("★ 合成态① 的表不许出现「★改善」，且必须印那句禁止读作改善", () => {
    const txt = renderReport(collapsed, "test");
    expect(txt, "闸没咬住 ⇒ 跑废了照样被读成变好").toContain(GATE_SENTENCE);
    expect(txt).toContain("超带退化");
    expect(txt, "任何一格都不许印成改善").not.toContain("★改善");
    // 闸只挡误读，不挡证据：退化那一格必须照常印，不许顺着"禁止改善"把退化也藏了
    expect(txt).toContain("⚠退化");
    expect(txt).toContain("副作用（禁读改善）");
    // 那句结论行的旧形（"改善 3 项"）不许再出现
    expect(txt).not.toContain("改善 3 项");
  });

  it("★ 合成态②③ ⇒ 成功率同档/改善时「★改善」照旧允许（防闸写反）", () => {
    for (const cmp of [flatOutcome, betterOutcome]) {
      const g = outcomeGate(cmp);
      expect(g.blocked, "结果类没超带退化就不该咬").toBe(false);
      expect(g.degraded).toEqual([]);
      const txt = renderReport(cmp, "test");
      expect(txt, "闸写反 ⇒ 正常的改善也被禁掉，表就没用了").toContain("★改善");
      expect(txt).not.toContain(GATE_SENTENCE);
      expect(txt).toContain("超出噪声带");
    }
  });

  it("★ 两态不同形：同一个成本改善，结果档一崩一稳 ⇒ 输出必须分叉", () => {
    const bad = renderReport(collapsed, "test");
    const good = renderReport(betterOutcome, "test");
    expect(bad).not.toBe(good);
    expect(bad.includes("★改善")).toBe(false);
    expect(good.includes("★改善")).toBe(true);
    expect(bad.includes(GATE_SENTENCE)).toBe(true);
    expect(good.includes(GATE_SENTENCE)).toBe(false);
  });

  it("带内的成功率下滑不触发闸（噪声就是噪声，不许借闸把成本改善也判成退化）", () => {
    const cmp = compare(
      T({ successRate: 0.75, passed: 9, tokensIn: 2000 }),
      T({ successRate: 0.68, passed: 8, tokensIn: 1200 }),
      band, ["A", "B"], ["A", "B"],
    );
    expect(outcomeGate(cmp).blocked).toBe(false);
    expect(renderReport(cmp, "test")).toContain("★改善");
  });

  it("闸只看结果类：成本类（工具失败／内存／重复动作）超带退化 ⇒ 不咬", () => {
    const cmp = compare(
      T({ successRate: 0.75, passed: 9, toolFailures: 0, repeats: 0 }),
      T({ successRate: 0.75, passed: 9, toolFailures: 9, repeats: 9 }),
      T({ successRate: 0.09, passed: 1, tokensIn: 100, tokensOut: 10, seconds: 2, toolFailures: 1, repeats: 1 }),
      ["A", "B"], ["A", "B"],
    );
    expect(outcomeGate(cmp).blocked, "闸的判据是「事情办成了没有」，不是「任何指标变差」").toBe(false);
    expect(outcomeGate(cmp).degraded).toEqual([]);
  });

  it("噪声带不可得 ⇒ 没有超带可言 ⇒ 闸不咬（也不印改善，那格本来就是判不出）", () => {
    const cmp = compare(T({}), T({ tokensIn: 900, successRate: 0 }), null, ["A"], ["A"]);
    expect(outcomeGate(cmp).blocked).toBe(false);
    expect(renderReport(cmp, "test")).not.toContain("★改善");
  });
});

// ── 身份闸（2026-10-05 补）────────────────────────────────────────────────────────
// 盘上现读的 readings.json **全部**没有 headSha／ranAt／model ⇒ 这道闸今天一定会咬，
// 这是设计意图：那份 2026-10-01 16:25 的冒烟读数至今在冒充"最新读数"，而它连自己是谁跑的都不知道。
describe("身份闸：读数缺 headSha／ranAt／model 任一 ⇒ 只当量级", () => {
  const r = (over: Partial<Row> = {}): Row => ({
    id: "A", model: "glm-5.2", headSha: "abc1234", ranAt: "2026-10-05T00:00:00Z",
    tokensIn: 1000, tokensOut: 100, seconds: 10,
    rssPeakMb: 100, toolFailures: 0, repeats: 0, ok: true, ...over,
  });

  it("★(c) 缺 model 键 ⇒ 走身份闸那一支，且那句逐字印出来", () => {
    const id = identityOf([r({ model: "" })]);
    expect(id.ok).toBe(false);
    expect(id.missing).toEqual(["model"]);
    expect(id.counts.model).toBe(1);
    expect(renderIdentityFace(id)).toContain(IDENTITY_SENTENCE);
  });

  it("★(d) 三键齐 ⇒ 不走那一支（防闸写反：不能把有身份的读数也一律降级）", () => {
    const id = identityOf([r(), r({ id: "B" })]);
    expect(id.ok).toBe(true);
    expect(id.missing).toEqual([]);
    const txt = renderIdentityFace(id);
    expect(txt).not.toContain(IDENTITY_SENTENCE);
    expect(txt).toContain("✅");
    expect(txt).not.toBe(renderIdentityFace(identityOf([r({ model: "" })])));
  });

  it("headSha 单独缺、ranAt 单独缺 ⇒ 各咬一次（任一即咬，不是三个都缺才咬）", () => {
    expect(identityOf([r({ headSha: "" })]).missing).toEqual(["headSha"]);
    expect(identityOf([r({ ranAt: "" })]).missing).toEqual(["ranAt"]);
    expect(identityOf([r({ headSha: "" })]).ok).toBe(false);
    expect(identityOf([r({ ranAt: "" })]).ok).toBe(false);
  });

  it("只有一行缺也算咬，且逐键计数指得到行数（修的人要知道去盖哪个章）", () => {
    const id = identityOf([r(), r(), r({ ranAt: "" })]);
    expect(id.ok).toBe(false);
    expect(id.rows).toBe(3);
    expect(id.counts).toEqual({ headSha: 0, ranAt: 1, model: 0 });
    expect(renderIdentityFace(id)).toContain("ranAt 缺 1/3 行");
  });

  it("parseReadings：存量形状（三键全无）⇒ 空串而不抛，身份闸咬", () => {
    const rows = parseReadings(readings([{ id: "A" }, { id: "B" }]));
    expect(rows[0]?.headSha).toBe("");
    expect(rows[0]?.ranAt).toBe("");
    expect(identityOf(rows).missing).toEqual(["headSha", "ranAt", "model"]);
    // 同一份文本盖上章之后就换档：证明走的是真解析，不是写死的空串
    const stamped = parseReadings(readings([
      { id: "A", model: "glm-5.2", headSha: "abc1234", ranAt: "2026-10-05T00:00:00Z" },
    ]));
    expect(identityOf(stamped).ok).toBe(true);
  });

  /** 手写一条完整读数（`readings()` 造的是 `r` 内层；这两支要测**外层**盖章与类型不对的章）。 */
  const rawRow = (rInner: Record<string, unknown>): string => JSON.stringify([
    { r: { id: "A", tokensIn: 1000, tokensOut: 100, seconds: 10, toolFailures: 0, repeatedSameAction: 0, ...rInner }, g: { ok: true } },
  ]);

  it("身份键也可以盖在 `{r, g}` 记录外层（写侧最终落哪一层由 #63 定，取料两侧都认）", () => {
    const outer = parseReadings(JSON.stringify([
      {
        headSha: "abc1234", ranAt: "2026-10-05T00:00:00Z",
        r: { id: "A", model: "glm-5.2", tokensIn: 1000, tokensOut: 100, seconds: 10, toolFailures: 0, repeatedSameAction: 0 },
        g: { ok: true },
      },
    ]));
    expect(outer[0]?.headSha).toBe("abc1234");
    expect(outer[0]?.ranAt).toBe("2026-10-05T00:00:00Z");
    expect(identityOf(outer).ok).toBe(true);
  });

  it("非字符串的身份键 ⇒ 当缺章（fail-closed，绝不把类型不对读成有身份）", () => {
    const numeric = parseReadings(rawRow({
      model: "glm-5.2", headSha: 1234, ranAt: 1759593600000,
    }));
    expect(numeric[0]?.headSha).toBe("");
    expect(identityOf(numeric).missing).toEqual(["headSha", "ranAt"]);
  });
});

describe("出口码：调用方不读文本也要分得出是哪道闸咬的", () => {
  const idOk: IdentityRuling = { ok: true, missing: [], counts: { headSha: 0, ranAt: 0, model: 0 }, rows: 3 };
  const idBite: IdentityRuling = { ok: false, missing: ["model"], counts: { headSha: 0, ranAt: 0, model: 3 }, rows: 3 };
  const noGate: OutcomeRuling = { blocked: false, degraded: [], suppressed: [] };
  const gated: OutcomeRuling = { blocked: true, degraded: ["successRate"], suppressed: ["tokensIn"] };

  it("四态各一个码：0 可信／3 身份闸／4 合取闸／5 两道都咬", () => {
    expect(exitCodeOf(idOk, noGate)).toBe(0);
    expect(exitCodeOf(idBite, noGate)).toBe(3);
    expect(exitCodeOf(idOk, gated)).toBe(4);
    expect(exitCodeOf(idBite, gated)).toBe(5);
  });

  it("汇总面把码说成话，且四个码各有各的说明（不许都写成「警告」）", () => {
    const faces = [0, 3, 4, 5].map((c) => renderExitFace(c));
    expect(new Set(faces).size, "出口码说明同形 ⇒ 调用方读不出原因").toBe(4);
    expect(faces[1]).toContain("身份闸");
    expect(faces[2]).toContain("禁止读作改善");
  });

  it("接线：两道闸都真的落到出口码，且身份面打在归因面之前、出口码打在表之后", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/eval/report.ts", import.meta.url)), "utf8");
    // 闸写在纯函数里，还得被渲染层/CLI 接上——不接上就是"算出来却不印"那一族
    expect(src, "合取闸没被 renderReport 调用 ⇒ 表照旧说谎").toContain("const gate = outcomeGate(cmp);");
    expect(src).toContain("process.stdout.write(renderIdentityFace(identity)");
    expect(src).toContain("exitCodeOf(identity, outcomeGate(cmp))");
    expect(src.indexOf("renderIdentityFace(identity)"), "身份面排在归因面之后 ⇒「同一档 ✅」先被读走")
      .toBeLessThan(src.indexOf("renderModelFace(face)"));
    expect(src.indexOf("process.exit(code)"), "码算出来却不退出 ⇒ 调用方只能 parse 文本")
      .toBeGreaterThan(src.indexOf("process.stdout.write(renderReport("));
  });
});

// ── 逐靶配对面（ledger #90，2026-10-05 补）──────────────────────────────────────
// 身份闸只回答"这份读数有没有盖章"，**没回答**"盖同一枚章的两趟逐靶翻了几个、缺章的落哪儿"。
// 本仓实测：同一装配跑两遍，12 个靶子里 3 个翻面（单趟翻面率 8–25%）——没有"靶子 id ↔ 每趟成败"的配对，
// 一把 1 靶的增益就永远埋在噪声底里。三处分辨力各配一个反向半，全用合成读数，不碰模型：
//   ⑴ 缺身份 ⇒ unknown-face、排除出同分母配对；有身份且同面 ⇒ 配对，异面 ⇒ 不配对。
//   ⑵ 逐靶翻转：差 1 个靶 ⇒ 印 `flips: 1`；差 0 个 ⇒ 印 `flips: 0`（两个独立用例，只见一个答案的尺没有分辨力）。
//   ⑶ pass^k 与 pass@k：一靶 2 次重复只过 1 次 ⇒ 两个数**分别**钉住（只报其一就把抖动读成稳过）。
import {
  faceKeyOf,
  indexFaces,
  passK,
  renderFacePair,
  renderPairing,
  runKeyOf,
  targetFlips,
  UNKNOWN_FACE_SENTENCE,
} from "../scripts/eval/report";

const FACE = { model: "glm-5.2", headSha: "aaaa111", maxSteps: "25", reps: "1", arm: "base" } as const;

describe("逐靶配对面：身份键取值走真解析（不是写死空串）", () => {
  it("盖章 ⇒ maxSteps/reps/arm/rep 全取到；存量读数 ⇒ 一律空串", () => {
    const stamped = parseReadings(readings([
      { id: "A", ...FACE, rep: "1", ranAt: "2026-10-05T00:00:00Z" },
    ]));
    expect(stamped[0]?.maxSteps).toBe("25");
    expect(stamped[0]?.reps).toBe("1");
    expect(stamped[0]?.arm).toBe("base");
    expect(stamped[0]?.rep).toBe("1");
    expect(runKeyOf(stamped[0]!)).not.toBeNull();   // 有脸 ⇒ 落进某一趟
    const legacy = parseReadings(readings([{ id: "A" }]));
    expect(legacy[0]?.maxSteps).toBe("");
    expect(legacy[0]?.arm).toBe("");
    expect(legacy[0]?.rep).toBe("");
    expect(runKeyOf(legacy[0]!)).toBeNull();        // 没脸 ⇒ unknown
    expect(faceKeyOf(legacy[0]!)).toBeNull();
  });
});

describe("indexFaces：同面才配对，缺身份的不进分母（unknown-face）", () => {
  it("★ 同面两趟（只有 ranAt 不同）⇒ 一个可比面、paired=true", () => {
    const idx = indexFaces(parseReadings(readings([
      { id: "A", ...FACE, ranAt: "2026-10-05T00:00:00Z" },
      { id: "A", ...FACE, ranAt: "2026-10-05T01:00:00Z" },
    ])));
    expect(idx.faces.length).toBe(1);
    expect(idx.faces[0]?.paired, "同一批分母跑两趟 ⇒ 这才谈得上噪声带").toBe(true);
    expect(idx.faces[0]?.ranAts.length).toBe(2);
    expect(idx.unknown).toBe(0);
  });

  it("★ 异面（arm 不同）⇒ 各成一格、都不 paired（不同形状不许被当成同分母）", () => {
    const idx = indexFaces(parseReadings(readings([
      { id: "A", ...FACE, arm: "base", ranAt: "2026-10-05T00:00:00Z" },
      { id: "A", ...FACE, arm: "candidate", ranAt: "2026-10-05T00:00:00Z" },
    ])));
    expect(idx.faces.length, "两副臂是两个面，不是同一个面里的两趟").toBe(2);
    for (const f of idx.faces) expect(f.paired, "只有一趟 ⇒ 无从配对").toBe(false);
    expect(idx.unknown).toBe(0);
  });

  it("★ 缺任一身份键 ⇒ 落进 unknown-face、绝不并进任何可比面", () => {
    const idx = indexFaces(parseReadings(readings([{ id: "A" }]))); // 六键全无（存量语料）
    expect(idx.faces.length).toBe(0);
    expect(idx.unknown).toBe(1);
    expect(idx.unknownIds).toEqual(["A"]);
  });

  it("★ 混堆：有身份的配对、缺身份的排除且**出声**（unknown-face 那一格印得出来）", () => {
    const idx = indexFaces(parseReadings(readings([
      { id: "A", ...FACE, ranAt: "2026-10-05T00:00:00Z", ok: true },
      { id: "A", ...FACE, ranAt: "2026-10-05T01:00:00Z", ok: false },
      { id: "B", model: "glm-5.2", headSha: "aaaa111", ranAt: "2026-10-05T02:00:00Z", maxSteps: "25", reps: "1" /* 缺 arm */ },
    ])));
    expect(idx.faces.length).toBe(1);          // 缺 arm 的那条没进可比面
    expect(idx.faces[0]?.paired).toBe(true);
    expect(idx.unknown).toBe(1);
    expect(idx.faces[0]?.flipped.includes("B"), "被排除的读数不许混进翻转账").toBe(false);
    const txt = renderPairing(idx);
    expect(txt).toContain(UNKNOWN_FACE_SENTENCE);
    expect(txt).toContain("1 条缺身份键");
    // 两态不同形：全有身份时那句要落到 0 条那一支
    expect(renderPairing(indexFaces(parseReadings(readings([{ id: "A", ...FACE, ranAt: "t0" }])))))
      .toContain("0 条（全部读数都盖齐了身份键）");
  });
});

describe("逐靶翻转计数：flips 要分得开 1 与 0（两个独立用例）", () => {
  it("targetFlips：两趟恰好差 1 个靶 ⇒ flips=1 且点得出翻红的那个", () => {
    const a = parseReadings(readings([
      { id: "X", ...FACE, ranAt: "t0", ok: true },
      { id: "Y", ...FACE, ranAt: "t0", ok: true },
      { id: "Z", ...FACE, ranAt: "t0", ok: true },
    ]));
    const b = parseReadings(readings([
      { id: "X", ...FACE, ranAt: "t1", ok: true },
      { id: "Y", ...FACE, ranAt: "t1", ok: true },
      { id: "Z", ...FACE, ranAt: "t1", ok: false },
    ]));
    const f = targetFlips(a, b);
    expect(f.flips).toBe(1);
    expect(f.flipped).toEqual(["Z"]);
    expect(f.compared).toBe(3);
  });

  it("targetFlips：两趟逐靶全同 ⇒ flips=0（另一格读数，不是把上面写死）", () => {
    const a = parseReadings(readings([
      { id: "X", ...FACE, ranAt: "t0", ok: true },
      { id: "Z", ...FACE, ranAt: "t0", ok: false },
    ]));
    const b = parseReadings(readings([
      { id: "X", ...FACE, ranAt: "t1", ok: true },
      { id: "Z", ...FACE, ranAt: "t1", ok: false },
    ]));
    expect(targetFlips(a, b).flips).toBe(0);
    expect(targetFlips(a, b).flipped).toEqual([]);
  });

  it("★ 报告里的 `flips:` 分辨得开 1 与 0（同面两趟分别喂进去）", () => {
    const oneFlip = parseReadings(readings([
      { id: "A", ...FACE, ranAt: "t0", ok: true },
      { id: "A", ...FACE, ranAt: "t1", ok: false },
    ]));
    expect(renderPairing(indexFaces(oneFlip))).toContain("flips: 1");

    const noFlip = parseReadings(readings([
      { id: "A", ...FACE, ranAt: "t0", ok: true },
      { id: "A", ...FACE, ranAt: "t1", ok: true },
    ]));
    const txt = renderPairing(indexFaces(noFlip));
    expect(txt).toContain("flips: 0");
    expect(txt, "把 0 也印成 1 ⇒ 噪声底被读成有增益").not.toContain("flips: 1");
    // renderFacePair 是 renderPairing 的组成，单独也钉一次（防止只测总表、单元写反没人管）
    expect(renderFacePair(indexFaces(oneFlip).faces[0]!)).toContain("flips: 1");
  });
});

describe("pass^k 与 pass@k：一靶 2 次重复只过 1 次时两个数必须分开", () => {
  it("★ 过 1／2 次 ⇒ pass@k=true 而 pass^k=false（分别钉住，不是只报一个）", () => {
    const rows = parseReadings(readings([
      { id: "A", rep: "1", ok: true },
      { id: "A", rep: "2", ok: false },
      { id: "B", rep: "1", ok: true },
      { id: "B", rep: "2", ok: true },
    ]));
    const t = passK(rows);
    const a = t.find((x) => x.target === "A")!;
    const b = t.find((x) => x.target === "B")!;
    expect(a.k).toBe(2);
    expect(a.passAtK, "至少过一次 ⇒ pass@2 为真").toBe(true);
    expect(a.passTopK, "有一次没过 ⇒ pass^2 为假").toBe(false);
    expect(a.passAtK, "这一格两个数不相等——这正是分辨力所在").not.toBe(a.passTopK);
    expect(b.passAtK).toBe(true);
    expect(b.passTopK, "两次都过 ⇒ pass^2 也为真").toBe(true);
  });

  it("全没过 ⇒ 两个都 false（第三态，防 passAtK 被写死成 true）", () => {
    const a = passK(parseReadings(readings([
      { id: "A", rep: "1", ok: false },
      { id: "A", rep: "2", ok: false },
    ]))).find((x) => x.target === "A")!;
    expect(a.passAtK).toBe(false);
    expect(a.passTopK).toBe(false);
  });
});

describe("接线：配对与未知面真的打进 CLI 出口（不算不印＝没算）", () => {
  it("report.ts 把 renderPairing(indexFaces(两侧全部行)) 打在成表之前", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/eval/report.ts", import.meta.url)), "utf8");
    expect(src, "算出来却不印 ⇒ 与没算同形").toContain("process.stdout.write(renderPairing(indexFaces(");
    expect(src).toContain("...baseRows.flat(), ...candRows.flat()");
    // 配对面排在正式对照表之前：先说"哪些靶翻了、谁没身份"，再谈整体差值
    expect(src.indexOf("renderPairing(indexFaces("), "配对读数排在整表之后 ⇒ 人先读了汇总数")
      .toBeLessThan(src.indexOf("renderReport(cmp, bandSource)"));
  });
});
