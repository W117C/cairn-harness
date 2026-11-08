// 插件设置卡片上的 MCP 激活数：active server 必须在卡片上就可见，不能只藏在抽屉里。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginsPane } from "../src/renderer/components/AppPage";
import type { PluginPanelSnapshot } from "../../../src/agent/plugins";

const noop = (): void => undefined;

const snap: PluginPanelSnapshot = {
  plugins: [{
    name: "demo",
    scope: "project",
    trust: "trusted",
    root: "/w/.agent/plugins/demo",
    counts: { skills: 1, commands: 0, agents: 0, hooks: 0, mcp: 2, lsp: 0, lspActive: 0 },
    skills: [{ name: "s", invoke: "/demo:s", description: "技能" }],
    commands: [],
    userConfig: [],
    errors: [],
    warnings: [],
  }],
  looseSkills: [],
  mcpServers: [
    { plugin: "demo", server: "one", state: "connected", tools: ["mcp__plugin_demo_one__a"] },
    { plugin: "demo", server: "two", state: "connected", tools: ["mcp__plugin_demo_two__b"] },
  ],
  activeMcpServers: ["demo/one"],
  activeMcpTools: ["mcp__plugin_demo_two__b"],
  mcpServerSummaries: [
    { key: "demo/one", plugin: "demo", server: "one", toolCount: 1, active: true, activeMode: "server", activeToolCount: 1 },
    { key: "demo/two", plugin: "demo", server: "two", toolCount: 1, active: true, activeMode: "tools", activeToolCount: 1 },
  ],
  toolScopes: [],
  errors: [],
  warnings: [],
};

describe("插件设置卡片：MCP 激活可见", () => {
  it("卡片 sub 显示已激活 server 数（整台 + 按工具都算）", () => {
    const h = renderToStaticMarkup(<PluginsPane snap={snap} onError={noop} refresh={noop} />);
    expect(h).toContain("已激活 2");
  });

  it("没有 active 数据时不在卡片上编造 0（口径由 McpServerRow 的未记录负责）", () => {
    const old: PluginPanelSnapshot = { ...snap, activeMcpServers: undefined, activeMcpTools: undefined, mcpServerSummaries: undefined };
    const h = renderToStaticMarkup(<PluginsPane snap={old} onError={noop} refresh={noop} />);
    expect(h).not.toContain("已激活 2");
  });
});
