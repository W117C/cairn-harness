// 「我们没有的能力」这份表要真的存在、每条都有状态与依据、且至少三条差距（不许删空）。
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd() + "/";
const doc = readFileSync(`${root}docs/gaps-vs-reference.md`, "utf8");
const rows = doc
  .split("\n")
  .filter((l) => /^\|\s*[^|\s]/.test(l) && !/^\|\s*(-+|---)/.test(l) && !l.includes("能力 | 参照产品"))
  .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

describe("差距表（我们没有的能力）", () => {
  it("至少五条，每条四列都有内容（能力/参照/依据等级/我们的状态/依据）", () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r.length).toBe(6);
      expect(r[0].length).toBeGreaterThan(2);
      expect(r[3]).toMatch(/已见|未证实|不适用/);
      expect(r[4].length).toBeGreaterThan(1);
      expect(r[5].length).toBeGreaterThan(6); // 依据要写清，不能空着
    }
  });

  it("至少三条「不做 / 未做 / 判不到 / 未验」——差距不许被删空", () => {
    // 「未验」也算差距（硬件/权限不到位时，逻辑有判据但真机没验）——三种缺口词都认。
    const gaps = rows.filter((r) => /不做|未做|判不到|未验/.test(r[4]));
    expect(gaps.length).toBeGreaterThanOrEqual(3);
  });

  it("「已见」的条目必须给出来源（URL 或仓库内路径）", () => {
    for (const r of rows.filter((x) => x[3] === "已见")) {
      expect(r[1]).toMatch(/https?:\/\/|`[^`]+`/);
    }
  });

  it("点到的仓库内文件真的存在", () => {
    for (const r of rows) {
      for (const m of r.join(" ").matchAll(/`((?:apps\/desktop\/)?(?:src|docs|tests|scripts)\/[\w./-]+\.(?:ts|tsx|cjs|md))`/g)) {
        expect(existsSync(`${root}${m[1]}`), `点名文件不存在：${m[1]}`).toBe(true);
      }
    }
  });
});
