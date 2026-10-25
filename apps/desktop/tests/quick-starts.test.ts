import { describe, expect, it } from "vitest";
// P2-1 空屏建议纯函数（判据来自计划：排序表 / fallback 补足去重 / 上限 4 / 回退项无具体文件名）。
// 文案值全部出处 STR（strings.ts 是唯一文案事实源），测试向 STR 取值比对，不另抄字面量。
import { buildQuickStarts, greetingFor, QUICK_START_FALLBACK, type QuickStartInput } from "../src/renderer/quick-starts";
import { STR } from "../src/renderer/strings";

const base: QuickStartInput = {
  git: null,
  hasPackageJson: false,
  scripts: [],
  readmeExists: false,
  lastSessionTitle: null,
};

describe("buildQuickStarts（空屏建议纯函数）", () => {
  it("全空输入 → 恰 3 条通用建议，顺序与 QUICK_START_FALLBACK 一致", () => {
    const out = buildQuickStarts(base);
    expect(out).toEqual([...QUICK_START_FALLBACK]);
    expect(out.length).toBe(3);
  });

  it("排序即表：四条件全满足 → [继续上次, 未提交计数, 跑测试, 解释结构]，上限 4 不掺回退", () => {
    const out = buildQuickStarts({
      git: { ok: true, branch: "main", dirtyFiles: 3 },
      hasPackageJson: true,
      scripts: ["test", "build"],
      readmeExists: true,
      lastSessionTitle: "修登录页",
    });
    expect(out).toEqual([
      STR.quickStarts.continueLast.replace("{title}", "修登录页"),
      STR.quickStarts.dirty.replace("{n}", "3"),
      STR.quickStarts.runTests,
      STR.quickStarts.explain,
    ]);
    expect(out.length).toBe(4);
  });

  it("继续上次：有标题才出、题面含标题、占首条；空串与纯空白等同无标题", () => {
    const out = buildQuickStarts({ ...base, lastSessionTitle: "改 README" });
    expect(out[0]).toBe(STR.quickStarts.continueLast.replace("{title}", "改 README"));
    expect(out.slice(1)).toEqual([QUICK_START_FALLBACK[0], QUICK_START_FALLBACK[1]]);
    expect(buildQuickStarts({ ...base, lastSessionTitle: "" })).toEqual([...QUICK_START_FALLBACK]);
    expect(buildQuickStarts({ ...base, lastSessionTitle: "   " })).toEqual([...QUICK_START_FALLBACK]);
  });

  it("未提交计数：git ok 且 >0 才出、数字上屏；0 / 缺省 / git 失败一律不出（防假绿）", () => {
    const hit = buildQuickStarts({ ...base, git: { ok: true, dirtyFiles: 5 } });
    expect(hit).toContain(STR.quickStarts.dirty.replace("{n}", "5"));
    const zero = buildQuickStarts({ ...base, git: { ok: true, dirtyFiles: 0 } });
    expect(zero).not.toContain(STR.quickStarts.dirty.replace("{n}", "0"));
    const undef = buildQuickStarts({ ...base, git: { ok: true } });
    expect(undef.some((s) => s.includes("0"))).toBe(false);
    const bad = buildQuickStarts({ ...base, git: { ok: false, dirtyFiles: 9 } });
    expect(bad).not.toContain(STR.quickStarts.dirty.replace("{n}", "9"));
  });

  it("跑测试：scripts 含 test 才出；无 test script 不出", () => {
    const hit = buildQuickStarts({ ...base, hasPackageJson: true, scripts: ["dev", "test"] });
    expect(hit).toContain(STR.quickStarts.runTests);
    const miss = buildQuickStarts({ ...base, hasPackageJson: true, scripts: ["dev", "build"] });
    expect(miss).not.toContain(STR.quickStarts.runTests);
  });

  it("解释结构：有 README 才出", () => {
    const hit = buildQuickStarts({ ...base, readmeExists: true });
    expect(hit).toContain(STR.quickStarts.explain);
    expect(hit.length).toBe(3);
  });

  it("补足去重：动态 2 条时回退补到 3 条，与动态同文的回退项只出现一次", () => {
    const out = buildQuickStarts({ ...base, lastSessionTitle: "做导出", readmeExists: true });
    // 动态 = [继续上次, 解释结构]；回退第一条与「解释结构」同文 ⇒ 跳过，补第一条够 3 即止。
    expect(out).toEqual([
      STR.quickStarts.continueLast.replace("{title}", "做导出"),
      STR.quickStarts.explain,
      QUICK_START_FALLBACK[1],
    ]);
    expect(out.filter((s) => s === STR.quickStarts.explain).length).toBe(1);
  });

  it("动态 1 条时补齐到 3 条：与回退同文的动态项不重复上屏", () => {
    const out = buildQuickStarts({ ...base, scripts: ["test"] });
    expect(out).toEqual([STR.quickStarts.runTests, QUICK_START_FALLBACK[0], QUICK_START_FALLBACK[1]]);
    expect(new Set(out).size).toBe(out.length);
  });

  it("回退项零具体文件名：不含路径分隔符与文件扩展名（通用建议纪律）", () => {
    for (const s of QUICK_START_FALLBACK) {
      expect(s.includes("/")).toBe(false);
      expect(/\.[A-Za-z]{1,6}\b/.test(s)).toBe(false);
      expect(s.trim().length).toBeGreaterThan(0);
    }
  });

  it("输出恒在 3–4 条之间、无重复（性质抽查）", () => {
    const combos: QuickStartInput[] = [
      base,
      { ...base, lastSessionTitle: "x" },
      { ...base, git: { ok: true, dirtyFiles: 1 } },
      { ...base, hasPackageJson: true, scripts: ["test"] },
      { ...base, readmeExists: true },
      { ...base, lastSessionTitle: "x", git: { ok: true, dirtyFiles: 2 }, hasPackageJson: true, scripts: ["test"], readmeExists: true },
      { ...base, lastSessionTitle: "x", readmeExists: true },
    ];
    for (const c of combos) {
      const out = buildQuickStarts(c);
      expect(out.length).toBeGreaterThanOrEqual(3);
      expect(out.length).toBeLessThanOrEqual(4);
      expect(new Set(out).size).toBe(out.length);
    }
  });
});

describe("greetingFor（问候语按时段 + 组内轮换）", () => {
  it("四档边界：0–4 深夜 / 5–11 早上 / 12–17 下午 / 18–23 晚上", () => {
    expect(greetingFor(0, () => 0)).toBe(STR.empty.greetingNight[0]);
    expect(greetingFor(4, () => 0)).toBe(STR.empty.greetingNight[0]);
    expect(greetingFor(5, () => 0)).toBe(STR.empty.greetingMorning[0]);
    expect(greetingFor(11, () => 0)).toBe(STR.empty.greetingMorning[0]);
    expect(greetingFor(12, () => 0)).toBe(STR.empty.greetingAfternoon[0]);
    expect(greetingFor(17, () => 0)).toBe(STR.empty.greetingAfternoon[0]);
    expect(greetingFor(18, () => 0)).toBe(STR.empty.greetingEvening[0]);
    expect(greetingFor(23, () => 0)).toBe(STR.empty.greetingEvening[0]);
  });

  it("越界小时数也落在合理档（取模防 NaN/负值造成空串）", () => {
    expect(greetingFor(24, () => 0)).toBe(STR.empty.greetingNight[0]);
    expect(greetingFor(-1, () => 0)).toBe(STR.empty.greetingEvening[0]);
  });

  it("组内轮换：不同 rand 出不同文案；rand 越界（NaN / 1）回落组内合法文案", () => {
    expect(greetingFor(9, () => 0)).not.toBe(greetingFor(9, () => 0.99));
    for (const r of [0, 0.3, 0.5, 0.99, NaN]) {
      expect(STR.empty.greetingMorning).toContain(greetingFor(9, () => r));
    }
  });
});
