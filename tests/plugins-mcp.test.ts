// M2e 任务 6/7 集成测试：stub MCP server（官方 SDK，stdio，仓库内 fixtures）——
// tools/list 进注册表且名字为 scoped 形态 / tools/call 结果回传（含 isError 路径）/
// 权限门对 MCP 工具同样生效（deny 规则）/ server 状态投影 / 信任门（未信任不激活→信任后生效）。
import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginRuntime, scopedToolName, parseScopedToolName } from "../src/agent/plugins";
import { evaluate, newAutonomySession } from "../src/permissions";
import type { ToolName } from "../src/tools/base";

const asTool = (s: string): ToolName => s as ToolName;

function fx(...parts: string[]): string {
  return join(process.cwd(), "fixtures", "plugins", ...parts);
}

const TRUST_DIR = join(tmpdir(), "m2e-mcp-trust-" + String(process.pid));

describe("M2e MCP 适配器（任务 7，真 stub server）", () => {
  it("tools/list 进注册表且名字为 scoped 形态；tools/call 结果回传", async () => {
    const rt = await PluginRuntime.load({
      projectPluginsDir: fx("project"),
      workspace: process.cwd(),
      pluginDataRoot: join(TRUST_DIR, "data"),
      trustFile: join(TRUST_DIR, "trust.json"),
    });
    await rt.trustDecide("echo-suite", true); // 信任后同样本开始生效
    await rt.connectMcp();
    const scopedEcho = scopedToolName("echo-suite", "stub", "echo");
    expect(scopedEcho).toBe("mcp__plugin_echo-suite_stub__echo");
    expect(rt.mcpTools.has(scopedEcho)).toBe(true);
    expect(rt.mcpTools.has(scopedToolName("echo-suite", "stub", "fail"))).toBe(true);
    expect(rt.mcpTools.get(scopedEcho)!.description).toContain("回显");
    // tools/call 结果回传
    const res = await rt.mcp.callTool("echo-suite", "stub", "echo", { text: "你好" });
    expect(res.ok).toBe(true);
    expect(res.output).toBe("echo: 你好");
    // isError 路径
    const bad = await rt.mcp.callTool("echo-suite", "stub", "fail", {});
    expect(bad.ok).toBe(false);
    // server 状态 = 投影消费面
    const st = rt.mcp.statuses();
    expect(st).toHaveLength(1);
    expect(st[0]!.state).toBe("connected");
    expect(st[0]!.tools).toContain(scopedEcho);
    await rt.shutdown();
  }, 30000);

  it("权限门对 MCP 工具同样生效（deny 规则命中 scoped 名即拦；普通调用同管线放行）", async () => {
    const scopedEcho = scopedToolName("echo-suite", "stub", "echo");
    const rules = [
      { behavior: "deny" as const, tool: scopedEcho, scope: "always" as const, id: "deny-mcp#0" },
      { behavior: "allow" as const, tool: scopedToolName("echo-suite", "stub", "fail"), scope: "always" as const, id: "allow-mcp#1" },
    ];
    const s = newAutonomySession("auto", { rules });
    const denied = evaluate(asTool(scopedEcho), { text: "x" }, s);
    expect(denied.verdict).toBe("deny");
    const allowed = evaluate(asTool(scopedToolName("echo-suite", "stub", "fail")), {}, s);
    expect(allowed.verdict).toBe("approve");
    // 无规则时普通 MCP 工具与读类工具同管线（auto 档放行）
    const plain = newAutonomySession("auto", {});
    expect(evaluate(asTool(scopedEcho), { text: "x" }, plain).verdict).toBe("approve");
  });

  it("scoped 名反解；bare 名永不命中（parseScopedToolName 只认 plugin_ 形态）", () => {
    expect(parseScopedToolName("mcp__plugin_echo-suite_stub__echo")).toEqual({
      plugin: "echo-suite",
      server: "stub",
      tool: "echo",
    });
    expect(parseScopedToolName("mcp__stub__echo")).toBeNull();
  });
});

describe("M2e 信任门（任务 6）", () => {
  it("未信任只列出：hook 不执行、MCP 不连接；信任后同样样本开始生效", async () => {
    const trustFile = join(TRUST_DIR, "trust-flow.json");
    await rm(trustFile, { force: true });
    const rt = await PluginRuntime.load({
      projectPluginsDir: fx("project"),
      workspace: process.cwd(),
      pluginDataRoot: join(TRUST_DIR, "data2"),
      trustFile,
    });
    const echo = rt.manifest.plugins.find((p) => p.name === "echo-suite");
    expect(echo?.trust).toBe("pending"); // 首次加载 = 信任卡数据源
    // 未信任：hook 激活面为空、MCP 不连接
    expect(rt.hooks.handlersFor("PreToolUse", { event: "PreToolUse", tool_name: "read_file" })).toHaveLength(0);
    await rt.connectMcp();
    expect(rt.mcpTools.size).toBe(0);
    expect(rt.mcp.statuses()).toHaveLength(0);
    // 信任决议持久化 + 重建激活面
    await rt.trustDecide("echo-suite", true);
    expect(rt.manifest.plugins.find((p) => p.name === "echo-suite")?.trust).toBe("trusted");
    expect(rt.hooks.handlersFor("PreToolUse", { event: "PreToolUse", tool_name: "read_file" }).length).toBeGreaterThan(0);
    await rt.connectMcp();
    expect(rt.mcpTools.has(scopedToolName("echo-suite", "stub", "echo"))).toBe(true);
    // 新实例读到持久化决议（下次会话直接生效）
    const rt2 = await PluginRuntime.load({
      projectPluginsDir: fx("project"),
      workspace: process.cwd(),
      pluginDataRoot: join(TRUST_DIR, "data2"),
      trustFile,
    });
    expect(rt2.manifest.plugins.find((p) => p.name === "echo-suite")?.trust).toBe("trusted");
    await rt.shutdown();
    await rt2.shutdown();
  }, 30000);

  it("拒绝决议同样持久化，样本保持不激活", async () => {
    const trustFile = join(TRUST_DIR, "trust-decline.json");
    await rm(trustFile, { force: true });
    const rt = await PluginRuntime.load({
      projectPluginsDir: fx("project"),
      workspace: process.cwd(),
      pluginDataRoot: join(TRUST_DIR, "data3"),
      trustFile,
    });
    await rt.trustDecide("echo-suite", false);
    expect(rt.manifest.plugins.find((p) => p.name === "echo-suite")?.trust).toBe("declined");
    expect(rt.hooks.handlersFor("SessionStart", { event: "SessionStart" })).toHaveLength(0);
    await rt.connectMcp();
    expect(rt.mcpTools.size).toBe(0);
    await rt.shutdown();
  });
});
