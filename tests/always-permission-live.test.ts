import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PermissionRule, ToolResultWithAudit } from "../src/permissions";
import { alwaysRulesPath } from "../src/permissions/rules";

const temporaryDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(project: PermissionRule[] = [], global: PermissionRule[] = []) {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "always-permission-live-"));
  temporaryDirs.push(dir);
  const workspace = join(dir, "workspace");
  const appdata = join(dir, "appdata");
  await mkdir(join(workspace, ".agent"), { recursive: true });
  await mkdir(appdata);
  const projectPath = join(workspace, ".agent", "permissions.json");
  const globalPath = join(appdata, "permissions.json");
  await writeFile(projectPath, JSON.stringify({ rules: project }));
  await writeFile(globalPath, JSON.stringify({ rules: global }));
  vi.stubEnv("DSH_APPDATA", appdata);
  vi.stubEnv("M2D_MEMORY_HOME", join(dir, "memory"));
  vi.stubEnv("M2E_USER_PLUGINS", join(dir, "plugins"));
  vi.stubEnv("M2E_LOOSE_SKILLS", join(dir, "skills"));
  vi.stubEnv("M1E_SAFE_MODE", "off");
  const permissions = await import("../src/permissions");
  const { AskGate } = await import("../src/main/ask-gate");
  const { gatedTool, setToolGateDeps } = await import("../src/main/tool-gates");
  const requests: string[] = [];
  let scope: "always" | "once" = "always";
  const gate = new AskGate({
    timeoutMs: 3000,
    notify: (request) => {
      requests.push(request.tool);
      gate.decide(request.askId, true, "user", scope);
    },
  });
  const autonomy = permissions.newAutonomySession("default", {
    rules: permissions.loadPermissionRules(projectPath, globalPath),
    planBlocked: () => false,
  });
  setToolGateDeps({ currentSession: () => ({ askGate: gate, autonomy, sandbox: null }) });
  // 这里验证门的决策；危险/网络命令只传给记录桩，绝不执行 shell 或出网。
  const execute = vi.fn(async () => ({ ok: true, output: "executed" }));
  const shell = gatedTool("run_shell", { name: "run_shell", run: execute });
  const writer = gatedTool("write_file", { name: "write_file", run: execute });
  return {
    dir, workspace, projectPath, globalPath, permissions, requests, gate, autonomy, execute, shell, writer,
    once: () => { scope = "once"; },
  };
}

describe("总是允许在本轮立即生效", () => {
  it("真实 runAgent 连续写两次只问一次，后续运行免批且不重复保存", async () => {
    const s = await setup();
    const scriptPath = join(s.dir, "script.jsonl");
    await writeFile(scriptPath, [
      { type: "tool_call", id: "write-1", name: "write_file", args: { path: "one.txt", content: "one" } },
      { type: "tool_call", id: "write-2", name: "write_file", args: { path: "two.txt", content: "two" } },
      { type: "assistant_message", content: "done" },
    ].map((event) => JSON.stringify(event)).join("\n"));
    vi.stubEnv("M1C_AUTONOMY_SCRIPT", scriptPath);
    vi.stubEnv("M0A_PROVIDER", "demo");
    const { runAgent } = await import("../src/main/agent-runner");
    const { initSettingsStore, setSettings } = await import("../src/main/settings-handlers");
    initSettingsStore(join(s.dir, "settings.json"));
    await setSettings({ autoMemory: false, autoVerify: false, subagentTools: false, safeMode: "off" });
    const first = await runAgent({ workspace: s.workspace, logPath: join(s.dir, "first.jsonl"), message: "first", mode: "default", askGate: s.gate });
    expect(s.requests).toEqual(["write_file"]);
    const results = first.filter((event) => event.type === "tool_result");
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(results[1]?.gate).toMatchObject({ layer: "L3-rule", verdict: "auto-approved", ruleId: "allow:write_file#0" });
    expect(await readFile(join(s.workspace, "one.txt"), "utf8")).toBe("one");
    expect(await readFile(join(s.workspace, "two.txt"), "utf8")).toBe("two");
    s.requests.length = 0;
    await runAgent({ workspace: s.workspace, logPath: join(s.dir, "second.jsonl"), message: "second", mode: "default", askGate: s.gate });
    expect(s.requests).toEqual([]);
    const saved = JSON.parse(await readFile(alwaysRulesPath(s.workspace), "utf8"));
    expect(saved.rules).toEqual([{ behavior: "allow", tool: "write_file", scope: "always" }]);
  });

  it("本轮使用持久规则的归一化与前缀语义，新增载荷或相似首词仍审批", async () => {
    const s = await setup();
    const ctx = { workspace: s.workspace };
    await s.shell.run({ command: "  pnpm   test  " }, ctx);
    s.once();
    const extended = await s.shell.run({ command: "pnpm test --runInBand" }, ctx) as ToolResultWithAudit;
    expect(s.requests).toEqual(["run_shell"]);
    expect(extended.gate).toMatchObject({ layer: "L3-rule", verdict: "auto-approved", ruleId: "allow:run_shell:pnpm test#0" });
    await s.shell.run({ command: "pnpm test > result.txt" }, ctx);
    await s.shell.run({ command: "pnpm test-other" }, ctx);
    expect(s.requests).toEqual(["run_shell", "run_shell", "run_shell"]);
    expect(s.autonomy.rules).toEqual(s.permissions.loadPermissionRules(s.projectPath, s.globalPath));
  });

  // 命令链的「总是允许」必须**每段各落一条** allow：`judgeChain` 先 `splitCommandChain` 拆段，
  // 再要求每一段都命中（任一段 miss ⇒ 整链 miss）。整条存成一个 pattern 时，那条 pattern 已不是
  // 任何一段 ⇒ 这条授权永远匹配不上——用户点过"总是允许"、回执报成功，同样的命令下一次照旧弹卡。
  // 反向锚点：只存第一段也不够（余下的段照样 miss），所以判据必须是"同一条链再来一次真的免批"。
  it("链式命令的「总是允许」：整条链重新提交时真的免批（不是只存了第一段）", async () => {
    const s = await setup();
    const ctx = { workspace: s.workspace };
    const chain = "pnpm test && echo done";
    await s.shell.run({ command: chain }, ctx);
    expect(s.requests).toEqual(["run_shell"]);
    const saved = JSON.parse(await readFile(alwaysRulesPath(s.workspace), "utf8"));
    // 每一段各一条，而不是一条含 `&&` 的整链
    expect(saved.rules).toEqual([
      { behavior: "allow", tool: "run_shell", pattern: "pnpm test", scope: "always" },
      { behavior: "allow", tool: "run_shell", pattern: "echo done", scope: "always" },
    ]);
    // 关键格：同一条链再来一次，一次都不问
    const again = await s.shell.run({ command: chain }, ctx) as ToolResultWithAudit;
    expect(s.requests).toEqual(["run_shell"]);
    expect(again.gate).toMatchObject({ layer: "L3-rule", verdict: "auto-approved" });
    // 载荷边界不许被这次授权撑大（同意范围不往外扩）
    s.requests.length = 0;
    await s.shell.run({ command: chain + " > /tmp/pwned" }, ctx);
    expect(s.requests).toEqual(["run_shell"]);
  });

  it("刷新保留全局 deny、项目 deny 和强制 ask，不把授权提高为全局规则", async () => {
    const s = await setup([
      { behavior: "deny", tool: "run_shell", pattern: "git push", scope: "always" },
      { behavior: "ask", tool: "run_shell", pattern: "echo hi", scope: "always" },
    ], [{ behavior: "deny", tool: "run_shell", pattern: "rm", scope: "always" }]);
    const ctx = { workspace: s.workspace };
    await s.writer.run({ path: "one.txt", content: "one" }, ctx);
    s.once();
    expect((await s.shell.run({ command: "rm build.txt" }, ctx)).ok).toBe(false);
    expect((await s.shell.run({ command: "git push" }, ctx)).ok).toBe(false);
    await s.shell.run({ command: "echo hi" }, ctx);
    await s.shell.run({ command: "echo hi" }, ctx);
    expect(s.requests).toEqual(["write_file", "run_shell", "run_shell"]);
    expect(s.autonomy.rules).toHaveLength(4);
    expect(s.autonomy.rules.find((rule) => rule.tool === "write_file")?.layer).toBe("project");
    expect(s.autonomy.rules.find((rule) => rule.pattern === "rm")?.layer).toBe("global");
    expect(s.execute).toHaveBeenCalledTimes(3);
  });

  // M1e 安全模式那道 gate 是**独立于** evaluate 的第二次审批（它跑在 evaluate 之前）。
  // 从前它的拒绝出口既不区分三种结局、也不挂 verdict ⇒ `lessons.ts` 的 isAskDeniedResult
  // 判不出"工具没执行"，一次审批超时会被记成"执行了但失败"，进而得出
  // 「这个工具在这个项目里用不了」——与 askDenialText 修的是同一族，只是漏了这一处。
  // 判据：拒绝出口必须带 verdict，且能被 isAskDeniedResult 认成"没执行"。
  it("安全模式 gate 的拒绝也带 verdict（超时不等于「这个工具用不了」）", async () => {
    const s = await setup();
    vi.stubEnv("M1E_SAFE_MODE", "gate");
    const ctx = { workspace: s.workspace };
    // 无人值守形状：没有门 ⇒ fail-closed，且 verdict = unattended
    const { gatedTool, setToolGateDeps } = await import("../src/main/tool-gates");
    setToolGateDeps({ currentSession: () => ({ askGate: null, autonomy: s.autonomy, sandbox: null }) });
    const bare = gatedTool("write_file", { name: "write_file", run: s.execute });
    const r = await bare.run({ path: "x.txt", content: "x" }, ctx) as ToolResultWithAudit;
    expect(r.ok).toBe(false);
    expect(r.gate).toMatchObject({ layer: "L3-mode", verdict: "unattended" });
    const { isAskDeniedResult } = await import("../src/agent/memory/lessons");
    expect(isAskDeniedResult({ type: "tool_result", callId: "c", ok: false, output: r.output, gate: r.gate } as never)).toBe(true);
    expect(s.execute).not.toHaveBeenCalled();
  });

  it("已保存的 allow 仍不能豁免 critical 审批", async () => {
    const s = await setup();
    for (let i = 0; i < 2; i++) await s.shell.run({ command: "rm -rf /" }, { workspace: s.workspace });
    expect(s.requests).toEqual(["run_shell", "run_shell"]);
    expect(s.execute).toHaveBeenCalledTimes(2);
  });

  it("网络命令仍逐次审批，不进入规则库或会话记忆", async () => {
    const s = await setup();
    for (let i = 0; i < 2; i++) {
      const result = await s.shell.run({ command: "curl https://example.com" }, { workspace: s.workspace }) as ToolResultWithAudit;
      expect(result.gate?.scope).toBe("once");
    }
    expect(s.requests).toEqual(["run_shell", "run_shell"]);
    expect(s.autonomy.rules).toEqual([]);
    expect(s.autonomy.sessionScopes.size).toBe(0);
    await expect(readFile(alwaysRulesPath(s.workspace))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("落库失败不新增内存规则，本次已批准工具可执行，后次仍须审批并报告错误", async () => {
    const s = await setup();
    await rm(join(s.workspace, ".agent"), { recursive: true });
    await writeFile(join(s.workspace, ".agent"), "not a directory");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 2; i++) {
      expect((await s.writer.run({ path: "one.txt", content: "one" }, { workspace: s.workspace })).ok).toBe(true);
    }
    expect(s.requests).toEqual(["write_file", "write_file"]);
    expect(s.autonomy.rules).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(errors.mock.calls.every(([message]) => message === "[permissions] always 规则落库失败:")).toBe(true);
    expect(s.execute).toHaveBeenCalledTimes(2);
  });

  it.each(["same", "alias"] as const)("并发批准不同工具后，两条授权都保留（workspace=%s）", async (pathKind) => {
    const s = await setup();
    const shellWorkspace = pathKind === "alias" ? s.workspace + "/." : s.workspace;
    const results = await Promise.all([
      s.writer.run({ path: "one.txt", content: "one" }, { workspace: s.workspace }),
      s.shell.run({ command: "pnpm test" }, { workspace: shellWorkspace }),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(s.requests).toEqual(["write_file", "run_shell"]);
    const saved = JSON.parse(await readFile(alwaysRulesPath(s.workspace), "utf8"));
    expect(saved.rules.map((rule: PermissionRule) => rule.tool).sort()).toEqual(["run_shell", "write_file"]);
    expect(s.autonomy.rules).toEqual(s.permissions.loadPermissionRules(s.projectPath, s.globalPath));
    s.once();
    await s.writer.run({ path: "two.txt", content: "two" }, { workspace: s.workspace });
    await s.shell.run({ command: "pnpm test --runInBand" }, { workspace: s.workspace });
    expect(s.requests).toHaveLength(2);
  });

  it("一笔保存失败不会阻断同时排队的其他工作区授权，也不会混入失败的规则", async () => {
    const s = await setup();
    await rm(join(s.workspace, ".agent"), { recursive: true });
    await writeFile(join(s.workspace, ".agent"), "not a directory");
    const otherWorkspace = join(s.dir, "other-workspace");
    await mkdir(otherWorkspace);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = await Promise.all([
      s.writer.run({ path: "one.txt", content: "one" }, { workspace: s.workspace }),
      s.shell.run({ command: "pnpm test" }, { workspace: otherWorkspace }),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(s.requests).toEqual(["write_file", "run_shell"]);
    expect(errors).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await readFile(alwaysRulesPath(otherWorkspace), "utf8"));
    expect(saved.rules.map((rule: PermissionRule) => rule.tool)).toEqual(["run_shell"]);
  });
});
