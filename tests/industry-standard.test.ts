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
      const paths = [...row[2].matchAll(/((?:apps\/desktop\/)?(?:tests|scripts)\/[\w./-]+\.(?:ts|cjs))/g)].map((m) => m[1]);
      expect(paths.length, `${row[0]} 的命令里没有可点到的文件`).toBeGreaterThan(0);
      for (const p of paths) expect(existsSync(`${root}${p}`), `${row[0]} 点名的文件不存在：${p}`).toBe(true);
    }
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
