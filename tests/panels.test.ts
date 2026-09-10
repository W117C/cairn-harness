// M1e 面板注册表单测：注册断言（M2d 起 +memory 面板；M2e 起 +plugins 面板）+ 未知 panel_id 兜底不抛 + SSR 冒烟。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FallbackPanel, KNOWN_PANEL_IDS, resolvePanel } from "../src/renderer/panels/registry";
import { projectDiffCards, projectMemoryWrites, projectTokenUsage, pendingApprovals } from "../src/renderer/projections";
import type { AgentEvent } from "../src/events";

describe("面板注册表（M1e + M2d memory + M2e plugins）", () => {
  it("注册表含五类（approvals / token / git / memory / plugins），全部为组件", () => {
    expect([...KNOWN_PANEL_IDS].sort()).toEqual(["approvals", "git", "memory", "plugins", "token"]);
    for (const id of KNOWN_PANEL_IDS) {
      expect(typeof resolvePanel(id)).toBe("function");
      expect(resolvePanel(id)).not.toBe(FallbackPanel);
    }
  });

  it("未知 panel_id 落兜底面板且渲染不抛异常", () => {
    expect(resolvePanel("bogus_panel")).toBe(FallbackPanel);
    expect(() => resolvePanel("")({ payload: {} })).not.toThrow();
    expect(() => resolvePanel("bogus_panel")({ payload: { eventCount: 7 } })).not.toThrow();
  });

  it("三面板 SSR 冒烟：待批卡 / token 累计 / diff 卡内容可见", () => {
    const approvalsHtml = renderToStaticMarkup(
      createElement(resolvePanel("approvals"), {
        payload: { asks: [{ askId: "a1", tool: "run_shell", args: { command: "pnpm test" }, reason: "默认档逐次审批" }] },
      }),
    );
    expect(approvalsHtml).toContain("待批 1");
    expect(approvalsHtml).toContain("run_shell");

    const tokenHtml = renderToStaticMarkup(
      createElement(resolvePanel("token"), {
        payload: { tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150, usageCount: 2, compactionCount: 2, suggestNewSession: true } },
      }),
    );
    expect(tokenHtml).toContain("150");
    expect(tokenHtml).toContain("建议开新会话");

    const gitHtml = renderToStaticMarkup(
      createElement(resolvePanel("git"), {
        payload: { diffs: [{ id: "t1", path: "src/todo.ts", content: "+ fixed", ok: true }] },
      }),
    );
    expect(gitHtml).toContain("src/todo.ts");
    expect(gitHtml).toContain("+ fixed");

    // M2d：记忆面板 SSR 冒烟（自获取快照渲染不抛 + 会话审计块在场）
    const memoryHtml = renderToStaticMarkup(
      createElement(resolvePanel("memory"), {
        payload: { memoryWrites: [{ callId: "c1", scope: "project", kind: "memory", topic: "note", ok: true, output: "已记录" }] },
      }),
    );
    expect(memoryHtml).toContain("本会话 remember 写入");
    expect(memoryHtml).toContain("note");

    // M2e：插件面板 SSR 冒烟（pending 出信任卡 + 按钮禁用因 preload 未接线 + MCP 状态投影）
    const pluginsHtml = renderToStaticMarkup(
      createElement(resolvePanel("plugins"), {
        payload: {
          plugins: {
            plugins: [{
              name: "echo-suite", scope: "project", trust: "pending", root: "/ws/.agent/plugins/echo-suite",
              counts: { skills: 1, commands: 1, agents: 1, hooks: 8, mcp: 1, lsp: 1 },
              errors: [], warnings: ["未知顶层字段：futureField"],
            }],
            looseSkills: [{ invoke: "/standalone-skill", description: "散装" }],
            mcpServers: [{ plugin: "echo-suite", server: "stub", state: "connected", tools: ["mcp__plugin_echo-suite_stub__echo"] }],
            errors: [{ plugin: "broken-plugin", message: "plugin.json 解析失败" }],
            warnings: [],
          },
        },
      }),
    );
    expect(pluginsHtml).toContain("echo-suite");
    expect(pluginsHtml).toContain("待信任");
    expect(pluginsHtml).toContain("首次加载");
    expect(pluginsHtml).toContain("/standalone-skill");
    expect(pluginsHtml).toContain("mcp__plugin_echo-suite_stub__echo");
    expect(pluginsHtml).toContain("broken-plugin");
    expect(pluginsHtml).toContain("futureField");
    expect(pluginsHtml).toContain("disabled"); // 决议通道未接线 → 按钮禁用（BLOCKED 备案）
  });

  it("token 投影：usage 累计 + compaction 计数（D11 ≥2 提示）", () => {
    const events: AgentEvent[] = [
      { type: "usage", inputTokens: 10, outputTokens: 5 },
      { type: "usage", inputTokens: 20, outputTokens: 8 },
      { type: "compaction", trigger: "manual", reason: "user_request", compressed_event_ids: [1, 2], summary: "s", summary_offset: 0, tokens_before: 100, tokens_after: 40 },
    ];
    const p = projectTokenUsage(events);
    expect(p.inputTokens).toBe(30);
    expect(p.outputTokens).toBe(13);
    expect(p.totalTokens).toBe(43);
    expect(p.usageCount).toBe(2);
    expect(p.compactionCount).toBe(1);
    expect(p.suggestNewSession).toBe(false);
  });

  it("memory 投影：remember tool_call/tool_result 配对（M2d）", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "m1", name: "remember", args: { scope: "project", kind: "memory", topic: "note" } },
      { type: "tool_result", callId: "m1", ok: true, output: "已记录" },
    ];
    const writes = projectMemoryWrites(events);
    expect(writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ callId: "m1", scope: "project", kind: "memory", topic: "note", ok: true });
  });

  it("diff 投影：write_file 聚合 + tool_result 配对状态；空事件 → 空列表", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts", content: "x" } },
      { type: "tool_result", callId: "t1", ok: true, output: "written" },
      { type: "tool_call", id: "t2", name: "write_file", args: { path: "b.ts", content: "y" } },
      { type: "tool_call", id: "t3", name: "read_file", args: { path: "a.ts" } },
    ];
    const diffs = projectDiffCards(events);
    expect(diffs.map((d) => d.id)).toEqual(["t1", "t2"]);
    expect(diffs[0]?.ok).toBe(true);
    expect(diffs[1]?.ok).toBe(null);
    expect(projectDiffCards([])).toEqual([]);
  });

  it("approvals 投影：未 resolved 计数；resolved 后归零（重启后 pending 必空）", () => {
    const asks = [
      { askId: "a1", tool: "run_shell", args: {} },
      { askId: "a2", tool: "write_file", args: {}, resolved: "approved" as const },
    ];
    expect(pendingApprovals(asks).map((a) => a.askId)).toEqual(["a1"]);
    expect(pendingApprovals([])).toEqual([]);
  });
});
