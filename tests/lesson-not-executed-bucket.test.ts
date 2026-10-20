// 「没有执行过」的那一族，**一个都不能漏进「工具连败」**（2026-10-20 独立评审追出的 MEDIUM-HIGH）。
//
// 旧形状：`isAskDeniedResult` 只认 `blockedBy === "permission"` 与 gate.verdict ∈ {rejected,timeout,unattended}
// ——而"没执行"的形状有**十种**（`TOOL_BLOCK_REASONS` 六道执行前闸 ＋ 四种 gate 结局，含 `denied`）。
// 漏掉的那五种（门直接拒 / 工具不在本会话工具表 / 被 skill 摘除 / 被 PreToolUse 钩子拦下 / 工具名不存在）
// 全部落进「执行了但失败」那一袋 ⇒ 沉淀出「「X」连败 N 次——同一手法连续失败，先换做法再重试」。
//
// **一次都没执行过的手法，哪来的失败？** 真因是授权状态没变（or 钩子不让过、or 这把工具压根不在这场会话里），
// 而那条错结论会被写进**项目记忆**（下一场会话回注）⇒ 一次策略 deny 变成永久能力限制。
// 评审实测：一条 `deny:write_file` 规则 ⇒ 项目记忆里留下「write_file 连败 2 次」。
//
// 这一份是**纯函数层**的判卷（`distillLessons` 是纯的，不必起真会话）；
// 端到端那一面（真 runAgent + 真记忆落盘 + 真回注）另有 `tests/memory-lessons.test.ts` 既有那组。
import { describe, expect, it } from "vitest";
import { distillLessons } from "../src/agent/memory/lessons";
import { TOOL_BLOCK_REASONS, type AgentEvent, type ToolBlockReason } from "../src/events";

const LOG = "/tmp/session-x.jsonl";

function trace(name: string, block: { blockedBy?: ToolBlockReason; gate?: { layer: "L0-hard"; verdict: "denied" } }): AgentEvent[] {
  return [
    { type: "tool_call", id: "c1", name, args: { path: "a" } },
    { type: "tool_result", callId: "c1", ok: false, output: "denied", ...block },
    { type: "tool_call", id: "c2", name, args: { path: "b" } },
    { type: "tool_result", callId: "c2", ok: false, output: "denied", ...block },
  ] as AgentEvent[];
}

describe("没有执行过 ⇒ 不许落进「工具连败」", () => {
  it("六道执行前闸（blockedBy 全族）都算「没有执行」", () => {
    // 穷举而不是抽样：漏掉哪一挡，那一挡就会静默地长出「连败」教训。
    for (const reason of TOOL_BLOCK_REASONS) {
      const ls = distillLessons(trace("write_file", { blockedBy: reason }), LOG);
      expect(ls.filter((x) => x.topic === "lesson-tool-streak-write_file"), `blockedBy=${reason} 被算成了「执行失败」`).toEqual([]);
      const l = ls.find((x) => x.topic === "lesson-not-executed-write_file");
      expect(l, `blockedBy=${reason} 没落进「没有执行」那一族`).toBeDefined();
      expect(l!.body).toContain("没有执行");
      // 条目要指出**是哪一道**拦的（文案是第二个注入面，结构列才是事实）
      expect(l!.body, `blockedBy=${reason} 的成因没写进条目`).toContain(reason);
    }
  });

  it("gate.verdict=denied（门直接拦，未执行）也算「没有执行」", () => {
    const ls = distillLessons(trace("write_file", { gate: { layer: "L0-hard", verdict: "denied" } }), LOG);
    expect(ls.filter((x) => x.topic === "lesson-tool-streak-write_file")).toEqual([]);
    const l = ls.find((x) => x.topic === "lesson-not-executed-write_file");
    expect(l).toBeDefined();
    expect(l!.body).toContain("denied");
  });

  it("真跑挂了的工具仍走「连败」那一支（别把真失败也一起豁免）", () => {
    // 反向对照：这一格不许被上一格带跑——真失败就该说「换做法」。
    const ls = distillLessons(
      [
        { type: "tool_call", id: "c1", name: "run_shell", args: { command: "x" } },
        { type: "tool_result", callId: "c1", ok: false, output: "exit code 1" },
        { type: "tool_call", id: "c2", name: "run_shell", args: { command: "y" } },
        { type: "tool_result", callId: "c2", ok: false, output: "exit code 1" },
      ] as AgentEvent[],
      LOG,
    );
    expect(ls.filter((x) => x.topic === "lesson-tool-streak-run_shell").length).toBe(1);
    expect(ls.filter((x) => x.topic === "lesson-not-executed-run_shell")).toEqual([]);
  });
});
