// 「行业最高」标准可判：六条线每条都要有阈值、命令、现读；命令必须真的存在。
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd() + "/";
const doc = readFileSync(`${root}docs/industry-standard.md`, "utf8");
const rows = doc
  .split("\n")
  .filter((l) => /^\|\s*S\d/.test(l))
  .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

describe("行业最高标准（本方口径）", () => {
  it("六条线都在，且每条三列都不空", () => {
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toHaveLength(4);
      expect(row[1].length).toBeGreaterThan(4); // 阈值
      expect(row[2].length).toBeGreaterThan(10); // 命令
      expect(row[3].length).toBeGreaterThan(2); // 现读
    }
    expect(rows.map((r) => r[0].split(" ")[0])).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
  });

  it("每条命令点到的脚本/测试文件真的存在（读数可复算，不是口号）", () => {
    for (const row of rows) {
      const paths = [...row[2].matchAll(/((?:apps\/desktop\/)?(?:tests|scripts)\/[\w./-]+\.(?:tsx|ts|cjs))/g)].map((m) => m[1]);
      expect(paths.length, `${row[0]} 的命令里没有可点到的文件`).toBeGreaterThan(0);
      for (const p of paths) expect(existsSync(`${root}${p}`), `${row[0]} 点名的文件不存在：${p}`).toBe(true);
    }
  });

  it("标准文档指向差距表（没有差距表就不算「最高」）", () => {
    expect(doc).toContain("docs/gaps-vs-reference.md");
    expect(existsSync(`${root}docs/gaps-vs-reference.md`)).toBe(true);
  });

  it("明确不做的两格都写了理由（≥8 字）", () => {
    const outs = doc.split("\n").filter((l) => /^\|\s*`wallpaper\./.test(l));
    expect(outs.length).toBeGreaterThanOrEqual(2);
    for (const line of outs) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      expect(cells[1].length, `理由太短：${line}`).toBeGreaterThan(8);
    }
  });
});

describe("按公开标准对照（外部阈值）", () => {
  const stdRows = doc
    .split("\n")
    .filter((l) => /^\|\s*(WCAG|CSP|Electron|OWASP)/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

  it("至少四条外部标准，条款写清（SC 编号 / CSP / Electron / OWASP）", () => {
    expect(stdRows.length).toBeGreaterThanOrEqual(4);
    for (const row of stdRows) {
      expect(row[0]).toMatch(/SC \d|CSP|Electron|OWASP/);
      expect(row[1].length).toBeGreaterThan(3); // 阈值
      expect(row[3].length).toBeGreaterThan(10); // 证据路径
    }
  });

  it("数值阈值的行：现读必须 ≥ 阈值（读不出数字就说明这条没真读）", () => {
    const contrast = stdRows.find((r) => r[0].includes("1.4.3"));
    expect(contrast, "缺少 WCAG 1.4.3 那一行").toBeDefined();
    const threshold = Number((contrast![1].match(/(\d+(?:\.\d+)?)\s*:?\s*1/) ?? [])[1]);
    expect(threshold).toBeCloseTo(4.5, 1);
    // 现读里必须出现 ≥4.5 的数字（真机算出来的最差格），否则这条只是口号
    const readings = [...contrast![2].matchAll(/(\d+(?:\.\d+)?)\s*\+?/g)].map((m) => Number(m[1]));
    expect(Math.max(...readings)).toBeGreaterThanOrEqual(4.5);
  });

  it("每条外部标准的证据文件都存在", () => {
    for (const row of stdRows) {
      const paths = [...row[3].matchAll(/((?:apps\/desktop\/)?(?:tests|scripts|src)\/[\w./-]+\.(?:tsx|ts|cjs))/g)].map((m) => m[1]);
      expect(paths.length, `${row[0]} 没有可点到的证据`).toBeGreaterThan(0);
      for (const p of paths) expect(existsSync(`${root}${p}`), `证据不存在：${p}`).toBe(true);
    }
  });
});
