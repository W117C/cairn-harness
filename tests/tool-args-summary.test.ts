// 「这一条工具调用在忙哪个对象」——一行摘要政策的唯一实现，与它的两个消费者。
//
// 起因（2026-09-22，准入轮的欠账）：把 worker 的 tool_call 从主对话流摘掉之后（第十三程），
// 右栏那一行只剩「🔧 read_file」——**它读过哪个文件**在界面上就再无一处可读。
// 补法不是把主流画回来，而是让右栏也用上同一份摘要政策：政策若分成两份，
// 一份记得 path、另一份早晚会忘（本仓反复犯的「同族各抄一份」）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectAgentPanel, toolArgsSummary } from "../src/renderer/projections";

describe("工具参数摘要政策", () => {
  it("文件位优先：path / file / filePath / target / filename 任取其一", () => {
    expect(toolArgsSummary({ path: "src/a.ts" })).toBe("src/a.ts");
    expect(toolArgsSummary({ file: "src/b.ts" })).toBe("src/b.ts");
    expect(toolArgsSummary({ filename: "c.ts" })).toBe("c.ts");
    // path 在场就不该退到 command——顺序即语义：用户先看「动了哪个文件」
    expect(toolArgsSummary({ path: "src/a.ts", command: "pnpm test" })).toBe("src/a.ts");
  });

  it("没有文件位才退到命令，再退到查询", () => {
    expect(toolArgsSummary({ command: "pnpm test" })).toBe("pnpm test");
    expect(toolArgsSummary({ pattern: "entersMain" })).toBe("entersMain");
    expect(toolArgsSummary({ command: "ls", pattern: "x" })).toBe("ls");
  });

  it("空串不算命中（否则会把「没有 path」演成一条空摘要）", () => {
    expect(toolArgsSummary({ path: "", command: "pnpm build" })).toBe("pnpm build");
  });

  it("兜底：首个标量、数字转串、无参给占位、复杂值转 JSON", () => {
    expect(toolArgsSummary({ q: 42 })).toBe("42");
    expect(toolArgsSummary({ list: [1, 2] })).toBe("[1,2]");
    expect(toolArgsSummary({})).toBe("—");
    expect(toolArgsSummary(null)).toBe("—");
  });

  it("有界：三个分支各自都不超过 120 字（摘要就是「一行」，不是「第一个字段」）", () => {
    for (const k of ["path", "command", "blob"]) {
      expect(toolArgsSummary({ [k]: "x".repeat(500) }), k).toHaveLength(120);
    }
  });
});

describe("一份政策，两个消费者", () => {
  const app = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

  it("主转录那行取的是 projections 的同一个实现，且 app.js 里没有第二份 pick 表", () => {
    expect(app).toContain("esc(toolArgsSummary(e.args))");
    // 抄一份回来 = 两份迟早分叉（本文件存在的全部理由）
    expect(app).not.toContain("pick('path'");
    expect(app).not.toMatch(/function toolSummary\b/);
  });

  it("右栏 worker 行的 recent 带得上目标（准入之后唯一可读回「它碰过哪个文件」的地方）", () => {
    const events = [
      {
        type: "agent_spawned", agent_id: "w-a", parent_event_id: 1, mode: "read",
        task: "调研", max_turns: 4, permission_mode: "default",
      },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.ts" }, agent_id: "w-a" },
    ] as never[];
    const col = projectAgentPanel(events)[0];
    expect(col.recent.at(-1)).toBe("🔧 read_file · src/todo.ts");
    // 计数面不受影响（摘的是显示形态，不是账）
    expect(col.toolStats.read_file).toBe(1);
  });

  it("两型都归因时，progress 与工具行同列（≤3 条由投影自己收口）", () => {
    const events = [
      { type: "agent_spawned", agent_id: "w-a", parent_event_id: 1, mode: "read", task: "t", max_turns: 4, permission_mode: "default" },
      ...Array.from({ length: 5 }, (_, i) => ({ type: "tool_call", id: "c" + String(i), name: "grep", args: { pattern: "p" + String(i) }, agent_id: "w-a" })),
    ] as never[];
    const recent = projectAgentPanel(events)[0].recent;
    expect(recent).toHaveLength(3);
    expect(recent.at(-1)).toBe("🔧 grep · p4");
  });

  it("面板渲染处仍截到 90 字（新摘要进的是有界那一行，不是无界文本）", () => {
    expect(app).toContain("String(r).slice(0, 90)");
  });
});
