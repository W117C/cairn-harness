// 项目目录在场性与报错话术判卷（2026-10-30 · 第 802 页）。
// 关键口径：已登记但目录不在场 ≠ 未登记。前者给「可能被移动」与重新定位入口，
// 后者仍是既有的「未注册」拒绝；missing 是派生状态，不写回 registry。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { annotateProjectPresence, missingProjectPathError } from "../src/main/project-presence";

const records = [{ path: "/tmp/alive", name: "A" }, { path: "/tmp/gone", name: "G" }];
const exists = async (path: string): Promise<boolean> => path === "/tmp/alive";

describe("项目列表的在场性标注", () => {
  it("逐条补 missing，顺序不变；健康项目 missing=false", async () => {
    const rows = await annotateProjectPresence(records, exists);
    expect(rows.map((r) => r.path)).toEqual(["/tmp/alive", "/tmp/gone"]);
    expect(rows.map((r) => r.missing)).toEqual([false, true]);
    expect(rows[0]?.name).toBe("A");
  });

  it("exists 抛错按不在场处理（盘点失败不能读成健康）", async () => {
    const rows = await annotateProjectPresence([{ path: "/tmp/x" }], async () => { throw new Error("EACCES"); });
    expect(rows[0]?.missing).toBe(true);
  });
});

describe("已登记但目录不在场的报错", () => {
  it("已登记 + 不在场 ⇒ 说「可能被移动」并给重新定位入口", async () => {
    const message = await missingProjectPathError("/tmp/gone", records, exists);
    expect(message).toContain("项目目录不存在");
    expect(message).toContain("可能已被移动或删除");
    expect(message).toContain("更改项目目录");
    expect(message).not.toContain("未注册");
  });

  it("未登记 / 空路径 / 目录仍在 ⇒ 不替换既有错误", async () => {
    expect(await missingProjectPathError("/tmp/other", records, exists)).toBeNull();
    // 未登记且目录也不在：仍是「未注册」的既有口径，不能被替换成「项目目录不存在」。
    expect(await missingProjectPathError("/tmp/other-missing", records, async () => false)).toBeNull();
    expect(await missingProjectPathError("", records, exists)).toBeNull();
    expect(await missingProjectPathError("/tmp/alive", records, exists)).toBeNull();
  });
});

describe("主进程接线见证", () => {
  const indexTs = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");
  it("listProjects 盘点在场性；setWorkspaceContext 先判「已登记但不在场」再走原校验", () => {
    expect(indexTs).toContain("annotateProjectPresence(records, async (path) =>");
    expect(indexTs).toContain("missingProjectPathError(requested, await projectRegistry.list()");
    expect(indexTs).toContain("if (missing !== null) return { ok: false, error: missing };");
  });
});
