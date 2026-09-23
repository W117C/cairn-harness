// 终端面板不许把「结果缺席」说成「执行中」。
// 动因：同一条真会话（`会话 2026-09-10 03:13.jsonl`）以 `run_shell pnpm test` 的 tool_call 收尾，
// 盘上没有它的 tool_result ⇒ `projectPanelData` 给出一行 `ok === null`，而 `app.js` 原先见到
// null 就渲染「执行中…」⇒ **重开一条早死掉的会话，右栏永远挂着"执行中"**。
// 这里既有纯函数判据（terminalRowState 四态），也有一条**跑 shipped 渲染代码**的接线判据
// （按仓里既有做法取 app.js 的那一段进 vm，不重写断言文案）。
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { projectPanelData, terminalRowState } from "../src/renderer/projections";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

const callEvent = (id: string, command: string): AgentEvent =>
  ({ type: "tool_call", id, name: "run_shell", args: { command } });
const resultEvent = (callId: string): AgentEvent =>
  ({ type: "tool_result", callId, ok: true, output: "1 passed" });

describe("终端行的四态：null 只说「没结果」，不说「在执行」", () => {
  it("真实现场形状：无结果的 run_shell ⇒ 投影给出 ok===null 一行（这是判据的事实源半边）", () => {
    const rows = projectPanelData([callEvent("c3", "pnpm test")], "/tmp/ws").terminal;
    expect(rows.length).toBe(1);
    expect(rows[0]?.ok).toBeNull();
  });

  it("ok===null 且这一屏不在跑 ⇒ kind=lost，文案不得出现「执行中」", () => {
    const st = terminalRowState(null, false);
    expect(st.kind).toBe("lost");
    expect(st.text).not.toContain("执行中");
    expect(st.text).toContain("无结果");
  });

  it("ok===null 且这一屏真在跑 ⇒ kind=running（这才是「执行中」唯一合法的用法）", () => {
    expect(terminalRowState(null, true).kind).toBe("running");
  });

  it("反面对手：有结果的行与 live 无关（两种 live 取值都给出同一个 kind）", () => {
    for (const [ok, kind] of [[true, "ok"], [false, "failed"]] as const) {
      expect(terminalRowState(ok, true).kind).toBe(kind);
      expect(terminalRowState(ok, false).kind).toBe(kind);
    }
  });
});

/** 把 app.js 里终端渲染那一段真跑一遍（不复制实现）：`panelLive` 是它读的模块级旗标。 */
function termBody(entry: unknown, panelLive: boolean): string {
  const a = source.indexOf("/** 一条 shell 调用 → 终端行");
  const b = source.indexOf("function terminalViewHTML", a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  const context: Record<string, unknown> = {
    esc: (s: unknown) => String(s),
    terminalRowState,
    panelLive,
    arguments0: entry,
    __out: "",
  };
  runInNewContext(source.slice(a, b) + "\n__out = termBodyHTML(arguments0);", context);
  return context.__out as string;
}

describe("渲染接线：状态格按 panelLive 走（跑 app.js 那段真代码）", () => {
  it("panelLive=false 且无结果 ⇒ 渲染 lost，不渲染「执行中…」", () => {
    const html = termBody({ callId: "c3", command: "pnpm test", ok: null, output: "" }, false);
    expect(html).toContain('data-term-state="lost"');
    expect(html).not.toContain("执行中");
  });

  it("panelLive=true 且无结果 ⇒ 渲染 running（正向半边，防止一律说死）", () => {
    const html = termBody({ callId: "c3", command: "pnpm test", ok: null, output: "" }, true);
    expect(html).toContain('data-term-state="running"');
    expect(html).toContain("执行中");
  });

  it("反面对手：有结果的行在两种 panelLive 下逐字相同（这条改的不给正常历史添东西）", () => {
    const row = { callId: "c1", command: "pnpm test", ok: true, output: "1 passed" };
    expect(termBody(row, false)).toBe(termBody(row, true));
    expect(termBody(row, false)).toContain('data-term-state="ok"');
  });
});
