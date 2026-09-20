// goal-trace 是**渲染层芯片与主进程判据共用**的那份 reduce，本文件判的是「共用」这件事本身：
// 渲染层为了不留第二份目标态，只保留 goalRelevant 筛过的一小段事件、再交 traceGoal 全量重算。
// 于是有一条新的失败形状——筛子漏收/多收某一类事件，芯片就会报出与判据不同的轮次或停止位
// （本仓点名的「第二事实源」，且这次是**看得见**的那一份）。判据：对每条流的所有前缀，
// 「筛过重算」必须与「整段重算」在芯片读的三字段上一字不差。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { GOAL_TURN_CAP_MAX, GOAL_TURN_CAP_MIN, goalRelevant, traceGoal } from "../src/agent/goal-trace";
import type { GoalSpec } from "../src/agent/goal-trace";
import { parseGoalSpec, projectGoal } from "../src/agent/goal";

/** 芯片实际读的三字段（evidence/wrote/at 只有判据读，芯片那份数组是被筛短过的，读不得）。 */
type ChipReadable = { spec: GoalSpec; turn: number; stopped: string | null } | null;
function chipFields(v: ChipReadable): { spec: GoalSpec; turn: number; stopped: string | null } | null {
  if (v === null) return null;
  return { spec: v.spec, turn: v.turn, stopped: v.stopped };
}

const G = (objective: string, maxTurns = 6, maxUsd = 0): AgentEvent =>
  ({ type: "goal_set", objective, max_turns: maxTurns, max_usd: maxUsd });
const goalTurn = (turn: number): AgentEvent => ({
  type: "user_message",
  content: "续跑",
  origin: { kind: "goal", turn, max_turns: 6 },
});
const human = (content: string): AgentEvent => ({ type: "user_message", content });
const verifyOk: AgentEvent = {
  type: "verify_result",
  ok: true,
  results: [{ command: "t", ok: true, output: "" }],
  callId: "v1",
  attempt: 1,
  maxAttempts: 3,
};
/** 一次真写入 = 配对的两条事件（`wrote` 由它们决定，芯片不该看见它们，但整段重算会读）。 */
const writePair: AgentEvent[] = [
  { type: "tool_call", id: "c1", name: "write_file", args: { path: "a.ts" } },
  { type: "tool_result", callId: "c1", ok: true, output: "wrote" },
];
const promoted: AgentEvent = {
  type: "user_message",
  content: "从 sidechat 提升过来的消息",
  origin: { kind: "sidechat", session_id: "sc-1", source_event_ids: [3] },
};
const stopped: AgentEvent = { type: "goal_stopped", reason: "轮次上限 6 已用尽", turn: 6, evidence: "failed" };

/** 覆盖到每一种会影响三字段的事件，且夹着"设→停→再设"的改设路径。 */
const STREAMS: AgentEvent[][] = [
  [],
  [human("没有目标的一段工作"), verifyOk],
  [G("把测试修绿"), human("第一条人发的"), goalTurn(2), ...writePair, goalTurn(3), verifyOk],
  [verifyOk, G("旧目标"), stopped, G("新目标"), goalTurn(2), promoted, goalTurn(3)],
  [G("目标", 25, 1.5), stopped, promoted, human("人的下一条")],
];

describe("goal-trace：芯片与判据读同一份 reduce", () => {
  it("逐前缀复算：筛过重算 == 整段重算（芯片读的三字段一字不差）", () => {
    for (const events of STREAMS) {
      const checked: unknown[] = [];
      for (let cut = 0; cut <= events.length; cut++) {
        const prefix = events.slice(0, cut);
        checked.push(chipFields(traceGoal(prefix.filter(goalRelevant))));
        expect(checked[cut]).toEqual(chipFields(projectGoal(prefix)));
      }
      // 前缀循环必须真跑到"整段"那一格：少一格就少一份证据（把循环改成只看整段，这里当场对不上）
      expect(checked.length).toBe(events.length + 1);
    }
  });

  it("goalRelevant 只收影响芯片读数的事件：验证/写入/sidechat 提升/人手消息都不进", () => {
    expect([verifyOk, ...writePair, promoted, human("人发的"), stopped].map((e) => goalRelevant(e))).toEqual([
      false, false, false, false, false, true,
    ]);
    expect(goalRelevant(G("x"))).toBe(true);
    expect(goalRelevant(goalTurn(2))).toBe(true);
  });

  it("没设过目标的会话：芯片与判据都报空（traceGoal 与 projectGoal 同 null）", () => {
    const empty = [human("忙了半天"), verifyOk, ...writePair];
    expect(traceGoal(empty.filter(goalRelevant))).toBeNull();
    expect(projectGoal(empty)).toBeNull();
  });

  it("改设目标即重新起跑：轮次回到 1、停止位清掉（两条路都得一样）", () => {
    const events = [G("旧"), stopped, G("新"), goalTurn(2)];
    const chip = traceGoal(events.filter(goalRelevant));
    expect(chip?.turn).toBe(2);
    expect(chip?.stopped).toBeNull();
    expect(chip?.spec.objective).toBe("新");
    expect(chipFields(chip)).toEqual(chipFields(projectGoal(events)));
  });

  it("轮次帽只有一个来源：UI 显示的区间 == parse 真钳制的区间", () => {
    // 芯片用这两个数写 min/max 与提示文案；哪天帽改了而 UI 抄的是旧数，用户会看到"能填 30 却被钳成 25"
    const wide = parseGoalSpec({ objective: "x", maxTurns: GOAL_TURN_CAP_MAX + 100 });
    expect(wide.spec?.maxTurns).toBe(GOAL_TURN_CAP_MAX);
    expect(wide.clamped.join()).toContain(String(GOAL_TURN_CAP_MAX));
    const narrow = parseGoalSpec({ objective: "x", maxTurns: GOAL_TURN_CAP_MIN - 5 });
    expect(narrow.spec?.maxTurns).toBe(GOAL_TURN_CAP_MIN);
    expect(narrow.clamped.join()).toContain(String(GOAL_TURN_CAP_MIN));
  });
});
