// M2e 任务 6/7 集成测试：stub MCP server（官方 SDK，stdio，仓库内 fixtures）——
// tools/list 进注册表且名字为 scoped 形态 / tools/call 结果回传（含 isError 路径）/
// 权限门对 MCP 工具同样生效（deny 规则）/ server 状态投影 / 信任门（未信任不激活→信任后生效）。
import { describe, expect, it } from "vitest";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PluginRuntime, scopedToolName, parseScopedToolName,
  MCP_ACTIVE_TOOL_LIMIT,
} from "../src/agent/plugins";
import { pluginToolSpecsFromRuntime, installPluginTools } from "../src/main/tool-gates";
import { TOOLS } from "../src/tools";
import { evaluate, newAutonomySession, type McpGrade } from "../src/permissions";
import type { ToolName } from "../src/tools/base";
import { McpManager } from "../src/agent/plugins/mcp";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

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
    // §11.7.2 的分级输入必须从 tools/list 一路走到注册表：echo 自标 readOnlyHint，fail 什么都不标
    expect(rt.mcpTools.get(scopedEcho)!.grade).toEqual({ annotated: true, readOnly: true });
    expect(rt.mcpTools.get(scopedToolName("echo-suite", "stub", "fail"))!.grade).toEqual({ annotated: false });
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

    // 服务器级懒加载：目录可见、工具规格默认不可见，激活后下一请求可见。
    const key = "echo-suite/stub";
    expect(rt.mcpServerSummaries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key, toolCount: 2, active: false }),
    ]));
    expect(rt.mcpServerTools(key)?.map((t) => t.name).sort()).toEqual(["echo", "fail"]);
    expect(rt.isMcpServerActive(key)).toBe(false);
    const before = pluginToolSpecsFromRuntime(rt).map((t) => t.name);
    expect(before).toEqual(expect.arrayContaining(["skill", "mcp_list", "mcp_activate", "mcp_release"]));
    expect(before).not.toContain(scopedEcho);
    const injectedBefore = installPluginTools(rt);
    try {
      expect(injectedBefore).toEqual(expect.arrayContaining(["mcp_list", "mcp_activate", "mcp_release"]));
      expect(injectedBefore).not.toContain(scopedEcho);
      const listed = await TOOLS["mcp_list"]!.run({}, { workspace: process.cwd() });
      expect(listed.ok).toBe(true);
      expect(listed.output).toContain(key);
      const activated = await TOOLS["mcp_activate"]!.run({ server: key }, { workspace: process.cwd() });
      expect(activated.ok).toBe(true);
      expect(activated.output).toContain(scopedEcho);
      const after = pluginToolSpecsFromRuntime(rt).map((t) => t.name);
      expect(after).toContain(scopedEcho);
      const injectedAfter = installPluginTools(rt);
      expect(injectedAfter).toContain(scopedEcho);
      for (const n of new Set([...injectedBefore, ...injectedAfter])) delete TOOLS[n];
      expect(rt.releaseMcpServer(key).ok).toBe(true);
      expect(rt.isMcpServerActive(key)).toBe(false);
    } finally {
      for (const n of new Set([...injectedBefore, "mcp_list", "mcp_activate", "mcp_release"])) delete TOOLS[n];
    }
    await rt.shutdown();
  }, 30000);

  it("大 server：整台超限显式拒绝；按工具可激活子集，仍受总帽约束", async () => {
    const ws = await mkdtemp(join(tmpdir(), "m2e-mcp-cap-"));
    const rt = await PluginRuntime.load({
      workspace: ws,
      pluginDataRoot: join(ws, "data"),
      trustFile: join(ws, "trust.json"),
      projectPluginsDir: join(ws, "no-plugins"),
    });
    const names: string[] = [];
    for (let i = 0; i < MCP_ACTIVE_TOOL_LIMIT + 1; i++) {
      const scoped = "mcp__plugin_fake_big__t" + String(i);
      names.push("t" + String(i));
      rt.mcpTools.set(scoped, {
        name: "t" + String(i),
        description: "",
        inputSchema: {},
        scopedName: scoped,
        grade: { annotated: false },
        plugin: "fake",
        server: "big",
      });
    }
    const whole = rt.activateMcpServer("fake/big");
    expect(whole.ok).toBe(false);
    expect(whole.error).toContain("超过上限");
    expect(whole.error).toContain("tools");
    expect(rt.isMcpServerActive("fake/big")).toBe(false);

    const subset = rt.activateMcpTools("fake/big", ["t0", "t1"]);
    expect(subset.ok).toBe(true);
    expect(rt.mcpServerSummaries().find((s) => s.key === "fake/big")).toMatchObject({
      active: true,
      activeMode: "tools",
      activeToolCount: 2,
    });
    expect(rt.isMcpToolActive("mcp__plugin_fake_big__t0")).toBe(true);
    expect(rt.isMcpToolActive("mcp__plugin_fake_big__t1")).toBe(true);
    expect(rt.isMcpToolActive("mcp__plugin_fake_big__t2")).toBe(false);
    expect(rt.activeMcpToolCount()).toBe(2);

    const specs = pluginToolSpecsFromRuntime(rt);
    const specNames = specs.map((s) => s.name);
    expect(specNames).toEqual(expect.arrayContaining(["mcp_list", "mcp_activate", "mcp_release", "mcp__plugin_fake_big__t0", "mcp__plugin_fake_big__t1"]));
    expect(specNames).not.toContain("mcp__plugin_fake_big__t2");
    const activateParams = specs.find((s) => s.name === "mcp_activate")?.parameters as {
      properties?: Record<string, unknown>;
    };
    expect(activateParams.properties?.tools).toBeDefined();
    expect(activateParams.properties?.tool).toBeDefined();

    expect(rt.releaseMcpTool("fake/big", "t0").ok).toBe(true);
    expect(rt.isMcpToolActive("mcp__plugin_fake_big__t0")).toBe(false);
    expect(rt.isMcpToolActive("mcp__plugin_fake_big__t1")).toBe(true);

    const tooMany = rt.activateMcpTools("fake/big", names);
    expect(tooMany.ok).toBe(false);
    expect(tooMany.error).toContain("超过上限");
    await rt.shutdown();
    await rm(ws, { recursive: true, force: true });
  });

  it("权限门对 MCP 工具同样生效（deny 规则命中 scoped 名即拦；普通调用同管线放行）", async () => {
    const scopedEcho = scopedToolName("echo-suite", "stub", "echo");
    const rules = [
      { behavior: "deny" as const, tool: scopedEcho, scope: "always" as const, id: "deny-mcp#0" },
      { behavior: "allow" as const, tool: scopedToolName("echo-suite", "stub", "fail"), scope: "always" as const, id: "allow-mcp#1" },
    ];
    const s = newAutonomySession("auto", { rules });
    const denied = evaluate(asTool(scopedEcho), { text: "x" }, s, { annotated: true, readOnly: true });
    expect(denied.verdict).toBe("deny");
    const allowed = evaluate(asTool(scopedToolName("echo-suite", "stub", "fail")), {}, s, { annotated: false });
    expect(allowed.verdict).toBe("approve"); // allow 规则命中（L3 先于档位）
    // 带只读注解的 MCP 工具在自主档放行（§11.7.2 自主列：写注解自动 ⇒ 只读更自动）
    const plain = newAutonomySession("auto", {});
    expect(evaluate(asTool(scopedEcho), { text: "x" }, plain, { annotated: true, readOnly: true }).verdict).toBe("approve");
  });

  it("§11.7.2 三档矩阵：只读注解放行 / 写注解与无注解逐次 / destructive 连自主档也送审", () => {
    const name = asTool("mcp__plugin_echo-suite_stub__t");
    const at = (mode: "read-only" | "default" | "auto", grade: McpGrade) =>
      evaluate(name, {}, newAutonomySession(mode, {}), grade);
    const ro: McpGrade = { annotated: true, readOnly: true };
    const wr: McpGrade = { annotated: true, readOnly: false };
    const de: McpGrade = { annotated: true, readOnly: false, destructive: true };
    const no: McpGrade = { annotated: false };
    // 只读档 = 只读注解白名单
    expect(at("read-only", ro).verdict).toBe("approve");
    expect(at("read-only", wr).verdict).toBe("deny");
    const roDeny = at("read-only", no);
    if (roDeny.verdict !== "deny") throw new Error("无注解在只读档应被拒，实得 " + roDeny.verdict);
    // 「只读注解白名单」也被 `plugins-check.ts` 自己那句断言消息用着 ⇒ 收产品依据句独有的条款号
    expect(roDeny.reason).toContain("§11.7.2 只读注解白名单");
    // 默认档：只读放行，其余逐次
    expect(at("default", ro).verdict).toBe("approve");
    expect(at("default", wr).verdict).toBe("ask");
    expect(at("default", no).verdict).toBe("ask");
    // 自主档：写注解自动；destructive 走风险通道送审；**无注解仍逐次**（豁免的是"写注解"不是沉默）
    expect(at("auto", wr).verdict).toBe("approve");
    const deAsk = at("auto", de);
    if (deAsk.verdict !== "ask") throw new Error("destructive 在自主档必须送审，实得 " + deAsk.verdict);
    expect(deAsk.risk).toBe("high");
    const autoNo = at("auto", no);
    if (autoNo.verdict !== "ask") throw new Error("无注解在自主档必须送审，实得 " + autoNo.verdict);
    expect(autoNo.reason).toContain("亦逐次（§11.7.2 fail-closed）");
    // 反面：少传注解 ≠ 不是 MCP（按无注解处理，fail-closed）
    expect(evaluate(name, {}, newAutonomySession("auto", {})).verdict).toBe("ask");
    // 非 MCP 的读类工具不受影响（新增谓词没把静态表拖下水）
    expect(evaluate(asTool("read_file"), { path: "a.ts" }, newAutonomySession("read-only", {})).verdict).toBe("approve");
    expect(evaluate(asTool("write_file"), { path: "a.ts" }, newAutonomySession("read-only", {})).verdict).toBe("deny");
  });

  it("方案门按统一写向口径判：未批 plan 时 allow 规则复活不了 MCP 写调用，只读注解仍可跑", () => {
    const name = asTool("mcp__plugin_echo-suite_stub__t");
    const s = newAutonomySession("auto", {
      rules: [{ behavior: "allow", tool: name, scope: "always", id: "allow-mcp#0" }],
    });
    s.planBlocked = () => true;
    for (const grade of [{ annotated: false }, { annotated: true, readOnly: false }] as McpGrade[]) {
      const d = evaluate(name, {}, s, grade);
      if (d.verdict !== "deny") throw new Error("plan 未批准时 MCP 写必须 deny，实得 " + d.verdict);
      expect(d.reason).toContain("方案门");
    }
    // server 明标只读：不受写禁影响（未批 plan 期间仍能查资料——白名单的意义就在这）
    expect(evaluate(name, {}, s, { annotated: true, readOnly: true }).verdict).toBe("approve");
    // 门只挡未批窗口：批准后同一调用按 allow 规则放行（不是永久禁 MCP）
    s.planBlocked = () => false;
    expect(evaluate(name, {}, s, { annotated: false }).verdict).toBe("approve");
    // 非 MCP 侧口径不变（写向静态表仍是唯一判据）
    const s2 = newAutonomySession("auto", {});
    s2.planBlocked = () => true;
    expect(evaluate(asTool("run_shell"), { command: "ls" }, s2).verdict).toBe("deny");
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

  // 审查 S1-7（修复任务书 2.1）端到端回归：项目级插件目录里有软链 => 指纹 bounded。
  // 2026-09-13 那轮把 bounded 在发现侧塌成 pending，而 trustDecide 写的是**无界**条目 =>
  // 「批准了还弹卡」死循环，含软链的合法开发布局永远装不上（rt2 那一步回到 pending）。
  it("有软链的项目级插件：批准一次即 trusted，重扫不复现（S1-7 死循环回归）", async () => {
    const ws = await mkdtemp(join(tmpdir(), "m2e-link-"));
    const pluginsDir = join(ws, "plugins");
    await cp(fx("project"), pluginsDir, { recursive: true });
    await symlink(
      join(pluginsDir, "echo-suite", ".claude-plugin", "plugin.json"),
      join(pluginsDir, "echo-suite", "linked.json"),
      "file",
    );
    const trustFile = join(ws, "trust-link.json");
    const load = (): Promise<PluginRuntime> =>
      PluginRuntime.load({ projectPluginsDir: pluginsDir, workspace: ws, pluginDataRoot: join(ws, "data"), trustFile });
    const rt = await load();
    expect(rt.manifest.plugins.find((p) => p.name === "echo-suite")?.trust).toBe("pending"); // 首次出卡
    // bounded 指纹（含软链）不可批准：没绑定的内容批准后能不经重新授权被替换。
    await expect(rt.trustDecide("echo-suite", true)).rejects.toThrow(/不能批准/);
    expect(rt.manifest.plugins.find((p) => p.name === "echo-suite")?.trust).toBe("pending");
    await rt.trustDecide("echo-suite", false); // 明确拒绝可以落盘
    expect(rt.manifest.plugins.find((p) => p.name === "echo-suite")?.trust).toBe("declined");
    const rt2 = await load();
    expect(rt2.manifest.plugins.find((p) => p.name === "echo-suite")?.trust).toBe("declined");
    await rt.shutdown();
    await rt2.shutdown();
    await rm(ws, { recursive: true, force: true });
  }, 30000);
});

// 审查 S1-3（修复任务书 1.3）：E5 曾在 client.connect() 之后**覆盖** transport.onclose，
// 而 SDK 的 connect() 已经在该属性上装了自己的包装（protocol.js:220-224 -> _onclose() 把
// ConnectionClosed 结算给全部在途 responseHandlers）。覆盖等于摘掉那半条链：server 进程
// 死掉时在途 tools/call 永不 settle，agent loop 卡死在工具调用上（改前是 reject 后 fail-visible）。
// 本用例锁两件事：onclose 链式（前一 handler 仍被调用）+ callTool 有总时长上限。
describe("MCP onclose 链式与 callTool 超时（S1-3 回归）", () => {
  it("链式包装不摘掉 SDK 那半；server 死亡后挂起的 tools/call 按超时 fail-visible", async () => {
    let sdkHalfCalls = 0;
    const transport = {
      onclose: undefined as (() => void) | undefined,
      close: async () => {},
    } as unknown as Transport;
    const client = {
      connect: async () => {
        const prev = transport.onclose; // 模拟 SDK：connect 内包装既有 onclose
        transport.onclose = () => { prev?.(); sdkHalfCalls++; };
      },
      listTools: async () => ({ tools: [] }),
      callTool: () => new Promise<never>(() => {}), // 永不 settle（server 已死）
      close: async () => {},
    } as unknown as Client;
    const mgr = new McpManager(async () => ({ client, transport }), 300, 120);
    expect((await mgr.connect("p", "s", { command: "x" })).ok).toBe(true);
    const inflight = mgr.callTool("p", "s", "hang", {});
    transport.onclose?.(); // 触发「server 进程死亡」
    expect(sdkHalfCalls).toBe(1); // 覆盖赋值会把它打成 0（回归点）
    const res = await inflight;
    expect(res.ok).toBe(false);
    expect(res.output).toContain("超时");
    expect(mgr.statuses()[0]!.state).toBe("failed"); // E5 本意仍成立
  }, 5000);
});

