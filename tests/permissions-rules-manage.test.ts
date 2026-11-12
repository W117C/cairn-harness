// 持久 allow 规则管理读端（roadmap 2026-11-10）：列出与按指纹撤销。
// 只管程序写的 always 文件——受跟踪 permissions.json（人策展）与全局层（用户自管）刻意不在管域。
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listAlwaysRules, removeAlwaysRules, savePermissionRules, alwaysRulesPath } from "../src/permissions/rules";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const makeWorkspace = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "rules-manage-"));
  dirs.push(dir);
  await mkdir(join(dir, ".agent"), { recursive: true });
  return dir;
};

describe("持久 allow 规则管理", () => {
  it("列出：文件不存在 = 空清单；有内容 = 原样解析", async () => {
    const ws = await makeWorkspace();
    expect(listAlwaysRules(ws)).toEqual([]);
    const path = alwaysRulesPath(ws);
    await savePermissionRules(path, [
      { behavior: "allow", tool: "run_shell", pattern: "pnpm test", scope: "always" },
      { behavior: "allow", tool: "web_fetch", scope: "always" },
    ]);
    const rules = listAlwaysRules(ws);
    expect(rules).toHaveLength(2);
    expect(rules[0]?.tool).toBe("run_shell");
    expect(rules[1]?.pattern).toBeUndefined();
  });

  it("撤销：按指纹精确删（含 pattern 逐字相等），返回删除数并落盘", async () => {
    const ws = await makeWorkspace();
    const path = alwaysRulesPath(ws);
    await savePermissionRules(path, [
      { behavior: "allow", tool: "run_shell", pattern: "pnpm test", scope: "always" },
      { behavior: "allow", tool: "run_shell", pattern: "pnpm lint", scope: "always" },
      { behavior: "allow", tool: "web_fetch", scope: "always" },
    ]);
    const removed = await removeAlwaysRules(ws, [{ behavior: "allow", tool: "run_shell", pattern: "pnpm test" }]);
    expect(removed).toBe(1);
    const rest = JSON.parse(await readFile(path, "utf8")) as { rules: { tool: string; pattern?: string }[] };
    expect(rest.rules).toHaveLength(2);
    expect(rest.rules.map((r) => r.pattern)).toEqual(["pnpm lint", undefined]);
  });

  it("撤销：0 条匹配不写盘、返回 0（删除数在调用方要可信）", async () => {
    const ws = await makeWorkspace();
    const path = alwaysRulesPath(ws);
    await savePermissionRules(path, [{ behavior: "allow", tool: "web_fetch", scope: "always" }]);
    const before = await readFile(path, "utf8");
    const removed = await removeAlwaysRules(ws, [{ behavior: "allow", tool: "run_shell", pattern: "nope" }]);
    expect(removed).toBe(0);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("撤销：无文件 = 0，且不凭空建文件", async () => {
    const ws = await makeWorkspace();
    expect(await removeAlwaysRules(ws, [{ behavior: "allow", tool: "web_fetch" }])).toBe(0);
    const { stat } = await import("node:fs/promises");
    await expect(stat(alwaysRulesPath(ws))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("边界：pattern 缺省与 pattern 空串不是同一条（指纹精确到形状）", async () => {
    const ws = await makeWorkspace();
    await savePermissionRules(alwaysRulesPath(ws), [{ behavior: "allow", tool: "web_fetch", scope: "always" }]);
    // pattern: undefined 的指纹才命中；带 pattern 的指纹不该误删裸工具名条目
    const removed = await removeAlwaysRules(ws, [{ behavior: "allow", tool: "web_fetch", pattern: "x" }]);
    expect(removed).toBe(0);
    expect(await removeAlwaysRules(ws, [{ behavior: "allow", tool: "web_fetch" }])).toBe(1);
  });
});
