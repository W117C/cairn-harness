// 浏览器驾驶三件（2026-11-06 业主①）判卷面：
//  ① 实现面（mock 宿主）：URL 协议闸、未授权/无活动标签的可行动文案、snapshot/pick 的
//     帽与错误透传——不碰真 Electron；
//  ② 注册缝：注册 ⇒ installAppTools 注入执行面与规格面；未注册 ⇒ 整族不付（CLI 形状）。
import { afterEach, describe, expect, it } from "vitest";
import { makeBrowserAgentTools } from "../src/main/browser-agent-tools";
import { ToolError, TOOLS, type ToolName } from "../../../src/tools";
import { isNetworkCommandCall, staticRisk } from "../../../src/permissions";
import {
  BROWSER_AGENT_SPECS,
  registerBrowserAgentTools,
  registeredBrowserAgentTools,
  unregisterBrowserAgentToolsForTest,
} from "../../../src/agent/browser-agent";
import { installAppTools } from "../../../src/main/agent-runner";

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
});

describe("实现面（mock 宿主）", () => {
  it("navigate：非 http(s) 拒；空 url 拒；宿主拒绝透传文案", async () => {
    const tools = makeBrowserAgentTools(hostMock({
      navigate: (url) => (url === "https://allowed.example/" ? { ok: true } : { ok: false, error: "站点未授权：blocked.example——授权走窗格地址栏的手动首访" }),
    }));
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
    }));
    const r = await tools.snapshot.run({}, { workspace: "/w" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("https://e/");
    expect(r.output).toContain("T");
    const bad = makeBrowserAgentTools(hostMock({ snapshot: async () => ({ ok: false, error: "侧栏浏览器没有活动标签" }) }));
    const rb = await bad.snapshot.run({}, { workspace: "/w" });
    expect(rb.ok).toBe(false);
    expect(rb.output).toContain("没有活动标签");
  });

  it("pick：帽 10 收口；无匹配说清；选择器错误透传", async () => {
    const tools = makeBrowserAgentTools(hostMock({
      pick: async (_sel, max) => ({ ok: true, matches: Array.from({ length: max }, (_, i) => ({ text: "x" + String(i), tag: "div" })) }),
    }));
    const r = await tools.pick.run({ selector: "div", max: 99 }, { workspace: "/w" });
    expect((r.output.match(/^/gm) ?? []).length).toBe(10);
    const none = makeBrowserAgentTools(hostMock({ pick: async () => ({ ok: true, matches: [] }) }));
    const rn = await none.pick.run({ selector: "div" }, { workspace: "/w" });
    expect(rn.output).toContain("无匹配元素");
    const err = makeBrowserAgentTools(hostMock({ pick: async () => ({ ok: false, error: "选择器执行失败" }) }));
    const re = await err.pick.run({ selector: "%%%" }, { workspace: "/w" });
    expect(re.ok).toBe(false);
  });
});

describe("注册缝（core × desktop 分工）", () => {
  it("注册 ⇒ installAppTools 注入执行面三件；规格面 BROWSER_AGENT_SPECS 同条件", () => {
    registerBrowserAgentTools(makeBrowserAgentTools(hostMock()));
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
