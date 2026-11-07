// 浏览器驾驶三件（2026-11-06 业主①）判卷面：
//  ① 实现面（mock 宿主）：URL 协议闸、未授权/无活动标签的可行动文案、snapshot/pick 的
//     帽与错误透传——不碰真 Electron；
//  ② 注册缝：注册 ⇒ installAppTools 注入执行面与规格面；未注册 ⇒ 整族不付（CLI 形状）。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { makeBrowserAgentTools } from "../src/main/browser-agent-tools";
import { ToolError, TOOLS, type ToolName } from "../../../src/tools";
import { isNetworkCommandCall, staticRisk } from "../../../src/permissions";
import {
  BROWSER_AGENT_SPECS,
  registerBrowserAgentTools,
  registeredBrowserAgentTools,
  unregisterBrowserAgentToolsForTest,
} from "../../../src/agent/browser-agent";
import { installAppTools, runAgent } from "../../../src/main/agent-runner";
import { initSettingsStore } from "../../../src/main/settings-handlers";

const testOwner = () => ({} as BrowserWindow);

function hostMock(overrides: Partial<{
  navigate: (url: string) => { ok: boolean; error?: string };
  snapshot: () => Promise<{ ok: boolean; url?: string; title?: string; text?: string; error?: string }>;
  pick: (selector: string, max: number) => Promise<{ ok: boolean; matches?: { text: string; tag: string }[]; error?: string }>;
}> = {}) {
  return {
    agentNavigate: overrides.navigate ?? ((url: string) => ({ ok: true })),
    snapshot: overrides.snapshot ?? (async () => ({ ok: true, url: "https://example.com/a", title: "示例页", text: "正文".repeat(4000) })),
    pickBySelector: overrides.pick ?? (async () => ({ ok: true, matches: [{ text: "按钮一", tag: "button" }, { text: "按钮二", tag: "a" }] })),
  } as never;
}

afterEach(() => {
  unregisterBrowserAgentToolsForTest();
  vi.unstubAllEnvs();
});

describe("实现面（mock 宿主）", () => {
  it("navigate：非 http(s) 拒；空 url 拒；宿主拒绝透传文案", async () => {
    const tools = makeBrowserAgentTools(hostMock({
      navigate: (url) => (url === "https://allowed.example/" ? { ok: true } : { ok: false, error: "站点未授权：blocked.example——授权走窗格地址栏的手动首访" }),
    }), testOwner);
    await expect(tools.navigate.run({ url: "ftp://x/" }, { workspace: "/w" })).rejects.toBeInstanceOf(ToolError);
    await expect(tools.navigate.run({ url: "" }, { workspace: "/w" })).rejects.toBeInstanceOf(ToolError);
    const denied = await tools.navigate.run({ url: "https://blocked.example/" }, { workspace: "/w" });
    expect(denied.ok).toBe(false);
    expect(denied.output).toContain("站点未授权");
    const okRes = await tools.navigate.run({ url: "https://allowed.example/" }, { workspace: "/w" });
    expect(okRes.ok).toBe(true);
    expect(okRes.output).toContain("browser_snapshot");
  });

  it("snapshot：成功面带 URL/标题/正文；失败透传", async () => {
    const tools = makeBrowserAgentTools(hostMock({
      snapshot: async () => ({ ok: true, url: "https://e/", title: "T", text: "正文" }),
    }), testOwner);
    const r = await tools.snapshot.run({}, { workspace: "/w" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("https://e/");
    expect(r.output).toContain("T");
    const bad = makeBrowserAgentTools(hostMock({ snapshot: async () => ({ ok: false, error: "侧栏浏览器没有活动标签" }) }), testOwner);
    const rb = await bad.snapshot.run({}, { workspace: "/w" });
    expect(rb.ok).toBe(false);
    expect(rb.output).toContain("没有活动标签");
  });

  it("pick：帽 10 收口；无匹配说清；选择器错误透传", async () => {
    const tools = makeBrowserAgentTools(hostMock({
      pick: async (_sel, max) => ({ ok: true, matches: Array.from({ length: max }, (_, i) => ({ text: "x" + String(i), tag: "div" })) }),
    }), testOwner);
    const r = await tools.pick.run({ selector: "div", max: 99 }, { workspace: "/w" });
    expect((r.output.match(/^/gm) ?? []).length).toBe(10);
    const none = makeBrowserAgentTools(hostMock({ pick: async () => ({ ok: true, matches: [] }) }), testOwner);
    const rn = await none.pick.run({ selector: "div" }, { workspace: "/w" });
    expect(rn.output).toContain("无匹配元素");
    const err = makeBrowserAgentTools(hostMock({ pick: async () => ({ ok: false, error: "选择器执行失败" }) }), testOwner);
    const re = await err.pick.run({ selector: "%%%" }, { workspace: "/w" });
    expect(re.ok).toBe(false);
  });
});

describe("注册缝（core × desktop 分工）", () => {
  it("无人值守运行不能读取继承的交互窗口", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cairn-browser-scheduled-"));
    try {
      const script = join(workspace, "script.jsonl");
      await writeFile(script, [
        JSON.stringify({ type: "tool_call", name: "browser_snapshot", id: "snapshot", args: {} }),
        JSON.stringify({ type: "assistant_message", content: "Finished." }),
      ].join("\n"));
      vi.stubEnv("M3A_MAIN_SCRIPT", script);
      initSettingsStore(join(workspace, "settings.json"));
      // Simulate the originating window context still being live when a scheduler job inherits it.
      registerBrowserAgentTools(makeBrowserAgentTools(hostMock({
        snapshot: async () => ({ ok: true, url: "https://example.com/a" }),
      }), testOwner));
      const run = { workspace, message: "Check browser", mode: "read-only" as const, modelSelection: { kind: "demo" as const } };
      const interactive = await runAgent({ ...run, logPath: join(workspace, "interactive.jsonl") });
      expect(interactive).toContainEqual(expect.objectContaining({
        type: "tool_result", callId: "snapshot", ok: true, output: expect.stringContaining("https://example.com/a"),
      }));
      const unattended = await runAgent({ ...run, logPath: join(workspace, "unattended.jsonl"), unattended: true });
      expect(unattended).toContainEqual(expect.objectContaining({
        type: "tool_result", callId: "snapshot", ok: false, output: expect.stringContaining("无人值守"),
      }));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });


  it("注册 ⇒ installAppTools 注入执行面三件；规格面 BROWSER_AGENT_SPECS 同条件", () => {
    registerBrowserAgentTools(makeBrowserAgentTools(hostMock(), testOwner));
    installAppTools({ automation: false });
    expect(TOOLS.browser_navigate).toBeDefined();
    expect(TOOLS.browser_snapshot).toBeDefined();
    expect(TOOLS.browser_pick).toBeDefined();
    expect(BROWSER_AGENT_SPECS.map((s) => s.name)).toEqual(["browser_navigate", "browser_snapshot", "browser_pick"]);
    expect(BROWSER_AGENT_SPECS.every((s) => typeof s.name === "string" && typeof s.description === "string" && s.parameters?.type === "object")).toBe(true);
    expect(staticRisk("browser_navigate" as ToolName, { url: "https://example.com/" }).level).toBe("high");
    expect(isNetworkCommandCall("browser_navigate" as ToolName, { url: "https://example.com/" })).toBe(true);
    expect(staticRisk("browser_snapshot" as ToolName, {})).toEqual(expect.objectContaining({ level: "none" }));
    expect(isNetworkCommandCall("browser_snapshot" as ToolName, {})).toBe(false);
  });

  it("未注册 ⇒ 不注入（CLI 形状：整族零成本）", () => {
    // 新进程未注册的形状在本进程里用「清空注册 + 未装标记重置」模拟不了 installAppTools 的
    // 进程级 installed 旗——所以只验证语义源：未注册时 registeredBrowserAgentTools() 为 null。
    unregisterBrowserAgentToolsForTest();
    expect(registeredBrowserAgentTools()).toBeNull();
  });
});
