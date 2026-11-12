// 第 1120 页：PluginsPane 的 MCP 激活计数/汇总一次建表，行与详情不再各自 filter/find。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("PluginsPane MCP 索引", () => {
  it("activeMcpByPlugin / mcpSummaryByKey 一次建好，selectedMcp 只 filter 一次", () => {
    expect(src).toContain("const { activeMcpByPlugin, mcpSummaryByKey } = useMemo(() => {");
    expect(src).toContain("const activeMcpByPlugin = new Map<string, number>();");
    expect(src).toContain("const mcpSummaryByKey = new Map<string, (typeof mcpSummaries)[number]>();");
    expect(src).toContain("const rows = useMemo(() => plugins.plugins");
    expect(src).toContain("const selected = useMemo(() => sel === null ? null : plugins.plugins.find");
    expect(src).toContain("const selectedMcp = useMemo(() => selected === null ? [] : plugins.mcpServers.filter((m) => m.plugin === selected.name), [plugins.mcpServers, selected]);");
    expect(src).toContain("activeMcpByPlugin.get(p.name) ?? 0");
    expect(src).toContain("mcpSummaryByKey.get(key)");
    expect(src).not.toContain("mcpSummaries.filter((s) => s.plugin === p.name && s.active).length");
    expect(src).not.toContain("plugins.mcpServers.filter((m) => m.plugin === selected.name).length");
  });
});
