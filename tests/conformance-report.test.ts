// 对照报告判卷：读数缺失必须是 missing（不许默认绿）；颜色换算走同一份对比度函数。
import { describe, expect, it } from "vitest";
import { buildConformanceReport, isolationChecks, parseCssRgb, reportVerdict, worstContrastOf } from "../src/verification/conformance";

const parity = { total: 22, covered: 20, partial: 0, absent: 0, out: 2 };

describe("公开标准对照报告", () => {
  it("真机颜色 ⇒ 最差对比度（暗 4.5+ / 亮 4.5+ 都算对）", () => {
    expect(worstContrastOf({ text: "rgb(240 239 236)", canvas: "rgb(21 21 21)" })).toBeGreaterThan(4.5);
    expect(worstContrastOf({ text: "rgb(11, 11, 11)", canvas: "rgb(252, 252, 251)" })).toBeGreaterThan(4.5);
    expect(worstContrastOf({ text: "nope", canvas: "rgb(1 1 1)" })).toBeNull();
  });

  it("两条臂都在 ⇒ 取更差的那条算 WCAG 1.4.3", () => {
    const rows = buildConformanceReport({
      readingsPath: "/tmp/r.json",
      parity,
      readings: {
        dark: { text: "rgb(240 239 236)", canvas: "rgb(21 21 21)" },
        light: { text: "rgb(200 200 200)", canvas: "rgb(252 252 251)" }, // 浅灰压白 ⇒ 不达标
        negativeControl: { cspViolations: 1 },
      },
    });
    const wcag = rows.find((r) => r.clause.includes("1.4.3"))!;
    expect(wcag.measured).toBeLessThan(4.5);
    expect(wcag.verdict).toBe("fail"); // 亮色那条不达标 ⇒ 整条不达标（不挑好看的报）
    expect(rows.find((r) => r.standard === "CSP Level 3")!.verdict).toBe("pass");
  });

  it("读数缺失 ⇒ missing，整体 incomplete（不许当通过）", () => {
    const rows = buildConformanceReport({ readingsPath: "/tmp/none.json", parity, readings: null });
    expect(rows.filter((r) => r.verdict === "missing").length).toBeGreaterThanOrEqual(2);
    expect(reportVerdict(rows)).toBe("incomplete");
  });

  it("对表有 partial/absent ⇒ 那一行 fail", () => {
    const rows = buildConformanceReport({
      readingsPath: "/tmp/r.json",
      parity: { ...parity, covered: 19, partial: 1 },
      readings: {
        dark: { text: "rgb(240 239 236)", canvas: "rgb(21 21 21)" },
        light: { text: "rgb(11 11 11)", canvas: "rgb(252 252 251)" },
        negativeControl: { cspViolations: 1 },
      },
    });
    expect(rows.find((r) => r.standard === "本方对表")!.verdict).toBe("fail");
    expect(reportVerdict(rows)).toBe("fail");
  });

  it("Electron 隔离四项：缺项少一项就不算 pass；读数缺失 ⇒ missing", () => {
    expect(isolationChecks(null)).toBeNull();
    const good = { hasRequire: "undefined", hasProcess: "undefined", hasAgent: "object", hasNodeGlobals: "undefined,undefined,undefined" };
    expect(isolationChecks(good)).toBe(4);
    expect(isolationChecks({ ...good, hasRequire: "function" })).toBe(3);
    const rows = buildConformanceReport({
      readingsPath: "/tmp/r.json", parity,
      readings: { dark: { worst: 5 }, light: { worst: 5 }, negativeControl: { cspViolations: 1 } },
      isolation: { ...good, hasRequire: "function" },
    });
    expect(rows.find((r) => r.standard.startsWith("Electron"))!.verdict).toBe("fail");
  });

  it("OWASP A09：脱敏后还有残留 ⇒ fail；没有脱敏读数 ⇒ missing", () => {
    const base = {
      readingsPath: "/tmp/r.json", parity,
      readings: { dark: { worst: 5 }, light: { worst: 5 }, negativeControl: { cspViolations: 1 } },
      isolation: { hasRequire: "undefined", hasProcess: "undefined", hasAgent: "object", hasNodeGlobals: "none" },
    };
    expect(buildConformanceReport({ ...base, redaction: { occurrencesAfter: 1 } })
      .find((r) => r.clause.includes("A09"))!.verdict).toBe("fail");
    expect(buildConformanceReport({ ...base, redaction: null })
      .find((r) => r.clause.includes("A09"))!.verdict).toBe("missing");
    expect(buildConformanceReport({ ...base, redaction: { occurrencesAfter: 0 } })
      .find((r) => r.clause.includes("A09"))!.verdict).toBe("pass");
  });

  it("全部达标 ⇒ pass；parseCssRgb 兼容空格与逗号两种写法", () => {
    expect(parseCssRgb("rgb(1 2 3)")).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseCssRgb("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3 });
    const rows = buildConformanceReport({
      readingsPath: "/tmp/r.json", parity,
      readings: {
        dark: { text: "rgb(240 239 236)", canvas: "rgb(21 21 21)" },
        light: { text: "rgb(11 11 11)", canvas: "rgb(252 252 251)" },
        negativeControl: { cspViolations: 1 },
      },
      isolation: { hasRequire: "undefined", hasProcess: "undefined", hasAgent: "object", hasNodeGlobals: "undefined,undefined,undefined" },
      redaction: { occurrencesAfter: 0 },
      keyboardPick: { picked: true },
    });
    expect(reportVerdict(rows)).toBe("pass");
  });
});

describe("键盘可达（WCAG 2.1.1）", () => {
  const base = {
    readingsPath: "/tmp/r.json",
    parity,
    readings: { dark: { worst: 5 }, light: { worst: 5 }, negativeControl: { cspViolations: 1 } },
    isolation: { hasRequire: "undefined", hasProcess: "undefined", hasAgent: "object", hasNodeGlobals: "none" },
    redaction: { occurrencesAfter: 0 },
  };
  it("键盘走通 ⇒ pass；走不通 ⇒ fail；没读数 ⇒ missing", () => {
    expect(buildConformanceReport({ ...base, keyboardPick: { picked: true } })
      .find((r) => r.clause.includes("2.1.1"))!.verdict).toBe("pass");
    expect(buildConformanceReport({ ...base, keyboardPick: { picked: false } })
      .find((r) => r.clause.includes("2.1.1"))!.verdict).toBe("fail");
    expect(buildConformanceReport({ ...base, keyboardPick: null })
      .find((r) => r.clause.includes("2.1.1"))!.verdict).toBe("missing");
  });
});
