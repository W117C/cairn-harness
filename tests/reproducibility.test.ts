import { describe, expect, it } from "vitest";
import {
  IDENTITY_DEBTS,
  classifyDivergence,
  containsWallClock,
  diffJsonPaths,
  differsOnlyByWallClock,
  reproducibleVerdict,
  stripObservation,
} from "../src/agent/reproducibility";
import { REPRO_RULES, debtProbeIsAbsorbable, runReproSelfTest } from "../scripts/replay-determinism-check";

describe("可复现性判据：纯函数", () => {
  it("diffJsonPaths 报的是路径，不是整坨 diff（判卷要能指到哪一个字段）", () => {
    const d = diffJsonPaths(
      { a: 1, list: ["x", "y"], nested: { k: 1 } },
      { a: 1, list: ["x", "z"], nested: { k: 2 } },
    );
    expect(d.map((x) => x.path).sort()).toEqual(["list[1]", "nested.k"]);
  });

  it("长度不同也算差异（数组少一条不是「等值」）", () => {
    expect(diffJsonPaths({ f: ["a"] }, { f: ["a", "b"] }).some((x) => x.path === "f.length")).toBe(true);
  });

  it("containsWallClock 只认毫秒级时间戳，不误伤普通数字", () => {
    expect(containsWallClock(1_790_134_752_319)).toBe(true);
    expect(containsWallClock(1_790)).toBe(false);
    expect(containsWallClock("a/1790134752319/b")).toBe(true);
    expect(containsWallClock("v1.2.3")).toBe(false);
    expect(containsWallClock(["x", 1_790_134_752_319])).toBe(true);
  });

  it("只差毫秒才算同形差异；差别的任何别的东西都算泄漏", () => {
    expect(differsOnlyByWallClock("s/1790134752319/a", "s/1790134752987/a")).toBe(true);
    expect(differsOnlyByWallClock("s/1790134752319/a", "s/1790134752987/b")).toBe(false);
    expect(differsOnlyByWallClock("no-ms-here", "no-ms-here-2")).toBe(false);
  });

  it("登记的每条债，前缀都必须真的能吸收同形差异（写错前缀 = 泄漏看起来被批准了）", () => {
    expect(IDENTITY_DEBTS.length).toBeGreaterThan(0);
    for (const debt of IDENTITY_DEBTS) expect(debtProbeIsAbsorbable(debt), "条目 " + debt.id + " 吸收不了自己的同形差异").toBe(true);
  });

  it("白名单只管登记过的前缀；别处的毫秒一律算泄漏", () => {
    const f = classifyDivergence(diffJsonPaths(
      { somewhereElse: "1790134752319" },
      { somewhereElse: "1790134752987" },
    ));
    expect(f.leaks.map((x) => x.path)).toEqual(["somewhereElse"]);
    expect(reproducibleVerdict(f).ok).toBe(false);
  });

  it("stripObservation 只剥观测字段，判卷字段一个不动", () => {
    const e = { type: "usage", inputTokens: 10, ts: 1_790_134_752_319 };
    expect(stripObservation(e)).toEqual({ type: "usage", inputTokens: 10 });
    expect("ts" in stripObservation(e)).toBe(false);
  });

  it("requireDebtHit 只对「复查登记表」那条开——干净状态不该因为没踩到债而红", () => {
    const clean = classifyDivergence([]);
    expect(reproducibleVerdict(clean).ok).toBe(true); // RD1 这类：等值就过
    expect(reproducibleVerdict(clean).detail).toContain("等值");
    expect(reproducibleVerdict(clean).detail).not.toContain("该删条目"); // 文案与判定必须同一个式子
    expect(reproducibleVerdict(clean, { requireDebtHit: true }).ok).toBe(false); // RD4：条目没被用到就要报
    expect(reproducibleVerdict(clean, { requireDebtHit: true }).detail).toContain("该删条目");
  });
});

describe("可复现性门：规则与反向对照", () => {
  it("四条规则今天都能判（且 RD1 若靠债过关，读数里必须写明）", async () => {
    expect(REPRO_RULES).toHaveLength(4);
    for (const rule of REPRO_RULES) {
      const v = await rule.run();
      expect(v.detail.length, rule.id + " 没给出读数").toBeGreaterThan(0);
      expect(v.ok, rule.id + " 不该红：" + v.detail).toBe(true);
    }
  }, 120_000);

  it("--self-test 全造得红（造不红就说明那条判据是摆设）", () => {
    const r = runReproSelfTest();
    expect(r.missed).toEqual([]);
    expect(r.caught.length).toBe(4);
  });
});
