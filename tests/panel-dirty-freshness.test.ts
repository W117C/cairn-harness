// 右栏重绘触发集（PANEL_DIRTY_TYPES）的双向闸。
//
// 这张表决定「哪些事件到达时右栏重算」。它此前是 app.js 里一份手写字面量，零判卷覆盖：
// 加一个投影字段就漏一类触发器，而漏的后果不是「不画」而是**画着旧的**——评审面板停在
// 上一批安全发现上，看着像当前结论（本仓最忌的那类「看得见但说谎」）。
// 实测漏了四条：usage / agent_message / agent_result 改 agents 列，security_report 改 merge 列。
//
// 双向都要判（单向都会自欺）：
//   正向 改了投影 → 必须在表里（否则右栏过期）；
//   反向 没改投影 → 不许在表里（refreshPanels 是 O(全部事件) 的重投影，白刷即纯成本——
//                  能力 9 的钱面；流式 delta 正因这条才刻意排除）。
// 每一行的 dirty 判定都来自实际跑 projectPanelData 的逐键比对，不来自注释或印象。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PANEL_DIRTY_TYPES, projectPanelData, type PanelData } from "../src/renderer/projections";

const SPAWN = { type: "agent_spawned", agent_id: "wt-7", parent_event_id: 1, mode: "write", task: "修排序", max_turns: 4, permission_mode: "default" };
const REPORT = { type: "agent_result", agent_id: "wt-7", ok: true, summary: "报告正文", callId: "call-1" };
const CALL = { type: "tool_call", id: "t1", name: "read_file", args: { path: "src/a.ts" }, agent_id: "wt-7" };
const ASK = { type: "approval_requested", id: "ap1", agent_id: "wt-7", tool: "run_shell", args_digest: "pnpm test", risk: "high" };

/** 一条事件的判卷样本：prefix 是它在真流里自然紧挨的前事（成对事件单独喂会测出假「零变化」）。 */
type Sample = { type: string; event: Record<string, unknown>; prefix?: Record<string, unknown>[] };

const DIRTIES: Sample[] = [
  { type: "tool_call", event: CALL },
  { type: "tool_result", event: { type: "tool_result", callId: "merge-wt-7", ok: true, output: "[merged] 3 files changed" }, prefix: [SPAWN, REPORT] },
  { type: "agent_spawned", event: { ...SPAWN, agent_id: "wt-8", parent_event_id: 2, mode: "read", task: "调研" } },
  { type: "agent_status", event: { type: "agent_status", agent_id: "wt-7", status: "done" } },
  { type: "approval_requested", event: ASK },
  { type: "approval_resolved", event: { type: "approval_resolved", id: "ap1", agent_id: "wt-7", decision: "allow", scope: "once" }, prefix: [SPAWN, ASK] },
  { type: "diff_comment", event: { type: "diff_comment", agent_id: "wt-7", path: "src/a.ts", line: 3, body: "评一句" } },
  { type: "usage", event: { type: "usage", agent_id: "wt-7", inputTokens: 10, outputTokens: 2 } },
  { type: "agent_message", event: { type: "agent_message", agent_id: "wt-7", kind: "progress", text: "一行进展" } },
  { type: "agent_result", event: REPORT },
  {
    type: "security_report", event: {
      type: "security_report", agent_id: "wt-7", llm_reviewed: true,
      findings: [{ severity: "high", path: "src/a.ts", line: 1, title: "T", description: "D", ruleId: "r1" }],
      summary: { total: 1, bySeverity: { high: 1 } },
    },
  },
];

const INERT: Sample[] = [
  { type: "assistant_delta", event: { type: "assistant_delta", callId: "d1", text: "流式一个字" } },
  { type: "assistant_message", event: { type: "assistant_message", content: "父会话的一句正文" } },
  { type: "user_message", event: { type: "user_message", content: "hi" } },
  { type: "session_meta", event: { type: "session_meta", schema: 1 } },
  { type: "error", event: { type: "error", message: "boom" } },
  { type: "compaction", event: { type: "compaction", tokens_before: 5, tokens_after: 2 } },
  { type: "verify_result", event: { type: "verify_result", callId: "v1", ok: true, kind: "test", summary: "s", agent_id: "wt-7" } },
  // 同型不同形状：普通 shell 回包确实不动六面——表按「型」粗分，宁少刷不误刷成常驻成本。
  { type: "tool_result(普通回包)", event: { type: "tool_result", callId: "s1", name: "run_shell", ok: true, output: "3 passed", agent_id: "wt-7" }, prefix: [SPAWN, REPORT] },
];

/** 这条事件加进流之后，panelData 的哪几个面变了。 */
function changedFaces(s: Sample): (keyof PanelData)[] {
  const before = projectPanelData([SPAWN, ...(s.prefix ?? [])] as never, null);
  const after = projectPanelData([SPAWN, ...(s.prefix ?? []), s.event] as never, null);
  return (Object.keys(before) as (keyof PanelData)[]).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
}

describe("正向：改了投影的类型必须在脏集里", () => {
  it.each(DIRTIES)("$type 实测改投影 ⇒ 必须进脏集（不在表里 = 右栏画着旧的）", (s: Sample) => {
    const faces = changedFaces(s);
    expect(faces, s.type + " 的样本没测出变化：样本失效了，先修判据再谈脏集").not.toHaveLength(0);
    expect(PANEL_DIRTY_TYPES.has(s.type), s.type + " 必须进脏集，否则右栏停在上一批数据上").toBe(true);
  });
});

describe("反向：没改投影的类型不许进脏集（每事件一次全量重投影是纯成本）", () => {
  it.each(INERT)("$type 实测零影响", (s: Sample) => {
    expect(changedFaces(s), s.type + " 现在会改投影了：那就该进表，并把它加进正向样本").toEqual([]);
    const base = s.type.replace(/\(.*\)$/, "");
    if (base === s.type) expect(PANEL_DIRTY_TYPES.has(base), s.type + " 不该进脏集").toBe(false);
  });
});

describe("表与判据同桌", () => {
  it("脏集里每一型都有正向样本覆盖（往表里加类型却不加样本 = 闸当场松掉）", () => {
    const covered = DIRTIES.map((s) => s.type);
    expect([...PANEL_DIRTY_TYPES].filter((t) => !covered.includes(t))).toEqual([]);
    expect(covered.length).toBeGreaterThan(8); // 不许塌成空表
  });

  it("判据只有一张表：app.js 问它，自己不再写一份触发条件", () => {
    const app = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
    expect(app).toContain("PANEL_DIRTY_TYPES.has(e.type)");
    expect(app).not.toMatch(/const PANEL_DIRTY\b/);
  });
});
