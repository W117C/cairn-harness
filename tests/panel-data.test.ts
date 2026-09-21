// R1a：抽屉面板数据单一来源（projectPanelData）——消灭渲染层的第二事实源（原型 mock 常量）。
// 面板内容 100% 事件流投影（projections.ts:1 既定原则）：无写入/无命令时必须空，
// 而不是回落到任何演示数据。
import { describe, expect, it } from "vitest";
import { projectDiffCards, projectPanelData } from "../src/renderer/projections";
import type { AgentEvent } from "../src/events";

const write = (id: string, path: string, content: string): AgentEvent[] => [
  { type: "tool_call", id, name: "write_file", args: { path, content } },
  { type: "tool_result", callId: id, ok: true, output: "written" },
];

describe("projectPanelData（抽屉面板投影：审阅 / 文件树 / 终端 / 合并）", () => {
  it("审阅与文件树共用同一事实源：路径集合与 projectDiffCards 逐项一致", () => {
    const events: AgentEvent[] = [
      ...write("w1", "src/agent/impact/index.ts", "a\nb\nc"),
      ...write("w2", "tests/impact.test.ts", "x\ny"),
    ];
    const panel = projectPanelData(events, null);
    expect(panel.files.map((f) => f.path)).toEqual(projectDiffCards(events).map((d) => d.path));
    expect(panel.files).toEqual([
      { path: "src/agent/impact/index.ts", added: 3, removed: 0, created: true, ok: true },
      { path: "tests/impact.test.ts", added: 2, removed: 0, created: true, ok: true },
    ]);
  });

  it("文件树按目录分组（同目录归一组，保持首次出现顺序）", () => {
    const events: AgentEvent[] = [
      ...write("w1", "src/agent/a.ts", "1"),
      ...write("w2", "src/agent/b.ts", "1"),
      ...write("w3", "tests/c.test.ts", "1"),
      ...write("w4", "README.md", "1"),
    ];
    const tree = projectPanelData(events, null).tree;
    expect(tree.map((g) => [g.dir, g.files.length])).toEqual([
      ["src/agent", 2],
      ["tests", 1],
      ["", 1],
    ]);
    expect(tree[0].files.map((f) => f.path)).toEqual(["src/agent/a.ts", "src/agent/b.ts"]);
  });

  it("终端面板 = run_shell 真调用与配对输出；未回结果的标 pending", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "s1", name: "run_shell", args: { command: "pnpm test" } },
      { type: "tool_result", callId: "s1", ok: false, output: "3 failed" },
      { type: "tool_call", id: "s2", name: "run_shell", args: { command: "pnpm gates" } },
    ];
    expect(projectPanelData(events, null).terminal).toEqual([
      { callId: "s1", command: "pnpm test", ok: false, output: "3 failed" },
      { callId: "s2", command: "pnpm gates", ok: null, output: "" },
    ]);
  });

  it("合并面板取 write worker 的状态与收尾态（projectMergeTower 同源）", () => {
    const events: AgentEvent[] = [
      { type: "agent_spawned", agent_id: "w1", parent_event_id: 1, mode: "write", task: "改投影", max_turns: 5, permission_mode: "default", worktree: ".agents/wt-w1", base_commit: "abc" },
      { type: "agent_status", agent_id: "w1", status: "done" },
      { type: "tool_result", callId: "merge-w1", ok: true, output: "[merged] abc123" },
    ];
    const merge = projectPanelData(events, null).merge;
    // verified / spentUsd 是 b998e48 起合并行的两个新面（「验过 / 说验过」四态 + 每条 worker 的钱）：
    // 这条靶子没有 verify_result、也没有价表可算 ⇒ 两值都如实为 null，不是缺字段。
    expect(merge).toEqual([{ agent_id: "w1", task: "改投影", status: "done", outcome: "merged", verified: null, spentUsd: null }]);
  });

  it("工作区：绝对路径取末段为显示名；null → 未配置", () => {
    expect(projectPanelData([], "/Users/me/coding-suite").workspace).toEqual({
      name: "coding-suite",
      path: "/Users/me/coding-suite",
    });
    expect(projectPanelData([], null).workspace).toBeNull();
  });

  it("空事件流 → 每块面板全空（不得回落到任何演示数据）", () => {
    expect(projectPanelData([], null)).toEqual({
      workspace: null,
      files: [],
      tree: [],
      terminal: [],
      merge: [],
      agents: [],
    });
  });

  it("非 write_file 的写动作（edit_file）不计入——审阅口径与 projectDiffCards 一致", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "e1", name: "edit_file", args: { path: "src/x.ts", old_string: "a", new_string: "b" } },
      { type: "tool_result", callId: "e1", ok: true, output: "patched" },
    ];
    const panel = projectPanelData(events, null);
    expect(panel.files).toEqual([]);
    expect(panel.tree).toEqual([]);
  });
});
