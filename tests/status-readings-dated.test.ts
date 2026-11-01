/** 第 953 页：`docs/REPOSITORY-STATUS.md` 里标「现读」的读数必须带日期。
 *
 *  本页自称「只写现态」，但 10-27 那批读数一直以「现读」的口吻留在表里：大入口行数写着
 *  `index.ts` 1434，而工作树里已是 2104（+670）；App chunk 写着 268.40 kB，实际 305.89 kB。
 *  没有日期的「现读」会一直看起来像刚量的——所以把「带日期」变成判据。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const doc = readFileSync(join(ROOT, "docs/REPOSITORY-STATUS.md"), "utf8");

describe("REPOSITORY-STATUS 的「现读」必须带日期（第 953 页）", () => {
  it("每个标「现读」的表格行都带 YYYY-MM-DD", () => {
    const rows = doc.split("\n").filter((l) => l.startsWith("|") && l.includes("现读"));
    expect(rows.length).toBeGreaterThan(0); // 全删了不算通过
    const undated = rows.filter((l) => !/20\d\d-\d\d-\d\d/u.test(l));
    expect(undated, "这些「现读」没有日期：" + undated.map((l) => l.slice(0, 40)).join(" | ")).toEqual([]);
  });

  it("性能读数写区间与中位，不写单点（第 956 页：两跑写成「启动约 2×」的教训）", () => {
    const row = doc.split("\n").find((l) => l.includes("长会话/长列表/大 diff"));
    expect(row, "找不到长会话那一行").toBeDefined();
    expect(row!, "时间类读数必须是区间，例如 187.7–311.8").toMatch(/\d+\.\d+\s*[–—-]\s*\d+\.\d+/u); // 两侧都要小数：日期 2026-11-01 不算区间
    expect(row!, "时间类读数必须给中位").toContain("中位");
  });

  it("本页至少有一处 2026-11-01 的复核标记（别的会话接手时知道读数的新旧）", () => {
    expect(doc).toContain("2026-11-01 复核");
  });
});
