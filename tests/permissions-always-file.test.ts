// #57 的判卷：always-allow 的**授权记录**不许落进随仓库分发的那份权限库（2026-10-05 第 380 页）。
//
// 缺陷形状（评审 S4/#57 的放大条件）：`<workspace>/.agent/permissions.json` 在本仓是**有意跟踪**
// 的，而「用户在审批卡上点一次总是允许」→ `persistAlwaysRule` 把一条 allow 写进**同一个文件**
// ⇒ 授权记录随仓库分发：**谁 clone，谁就继承那一次授权**。
// 它与 S4 是同族两半：S4 修的是「谁放宽了谁」不可判；这一条修的是「授权跟着仓库跑」。
//
// 修法是**分文件**而不是改名整体迁移：`permissions.json` 里可能有人写的项目策略（该继续被跟踪），
// 只有**程序写**的那部分搬去 `permissions.always.json`。
//
// 本页判两件，都在能当场跑的面（读侧与落点决策都在干净文件里）：
//   ① 落点决策纯函数：路径落在 `.agent/permissions.always.json`，且它真被 `.gitignore` 排除；
//   ② 读侧**透明并入**：同目录有那一份就必须读进来（否则搬走写入端＝批准过的规则静默失效）。
import { it, expect, describe } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALWAYS_RULES_FILE, alwaysRulesPath, loadPermissionRules } from "../src/permissions/rules";

async function workspaceWith(files: Record<string, string>): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), "perm-always-"));
  await mkdir(join(ws, ".agent"), { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(ws, ".agent", name), body, "utf8");
  return ws;
}

const tracked = JSON.stringify({ rules: [{ behavior: "deny", tool: "run_shell", pattern: "git push", scope: "always", id: "p1" }] });
const always = JSON.stringify({ rules: [{ behavior: "allow", tool: "write_file", scope: "always", id: "a1" }] });

describe("① 落点：授权记录去独立文件，且被 git 排除", () => {
  it("路径是 .agent/permissions.always.json（与被跟踪那份**不同名**）", () => {
    expect(alwaysRulesPath("/ws")).toBe("/ws/.agent/" + ALWAYS_RULES_FILE);
    expect(alwaysRulesPath("/ws")).not.toContain('"permissions.json"');
    expect(ALWAYS_RULES_FILE).not.toBe("permissions.json");
  });

  it("该文件名真在 .gitignore 里（否则搬了地方也照样随仓库分发——那等于没修）", async () => {
    const ignore = await readFile(join(process.cwd(), ".gitignore"), "utf8");
    expect(ignore, ".gitignore 里没有这条 ⇒ #57 只搬了位置没解决分发").toContain(".agent/" + ALWAYS_RULES_FILE);
  });
});

describe("② 读侧透明并入（漏了这一半就是静默失效）", () => {
  it("两份都在 ⇒ 都被读到，且**都算 project 层**（授权不升级成全局地板）", async () => {
    const ws = await workspaceWith({ "permissions.json": tracked, [ALWAYS_RULES_FILE]: always });
    try {
      const rules = loadPermissionRules(join(ws, ".agent", "permissions.json"));
      // 钉「行为＋工具」：`parsePermissionsFile` 会**重新派生** id（`行为:工具[:模式]#序号`），
      // 文件里写的 id 不保留——初版这里钉 id，红了才知道是判据错而不是实现错。
      expect(rules.map((r) => r.behavior + ":" + r.tool).sort()).toEqual(["allow:write_file", "deny:run_shell"]);
      expect(rules.every((r) => r.layer === "project")).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("只被跟踪那份 ⇒ 行为与从前逐字同形（没有 always 文件时零行为）", async () => {
    const ws = await workspaceWith({ "permissions.json": tracked });
    try {
      const rules = loadPermissionRules(join(ws, ".agent", "permissions.json"));
      expect(rules.map((r) => r.behavior + ":" + r.tool)).toEqual(["deny:run_shell"]);
      expect(rules.every((r) => r.layer === "project")).toBe(true);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("只 always 那份（用户还没写过项目策略）⇒ 也读得到", async () => {
    const ws = await workspaceWith({ [ALWAYS_RULES_FILE]: always });
    try {
      expect(loadPermissionRules(join(ws, ".agent", "permissions.json")).map((r) => r.behavior + ":" + r.tool)).toEqual(["allow:write_file"]);
    } finally { await rm(ws, { recursive: true, force: true }); }
  });

  it("always 那份坏了 ⇒ fail-closed 抛错（不许静默当成空库，那会把授权读成没授权）", async () => {
    const ws = await workspaceWith({ "permissions.json": tracked, [ALWAYS_RULES_FILE]: "{ 不是 JSON" });
    try {
      expect(() => loadPermissionRules(join(ws, ".agent", "permissions.json"))).toThrow();
    } finally { await rm(ws, { recursive: true, force: true }); }
  });
});
