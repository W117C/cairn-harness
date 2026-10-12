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

/** 芯片实际读的字段（evidence/wrote/at 只有判据读，芯片那份数组是被筛短过的，读不得）。
 *  v2.16 起含 `paused`：挂起位也是芯片要投影的读数，漏进筛子就会报出与判据不同的状态。 */
type ChipReadable = { spec: GoalSpec; turn: number; stopped: string | null; paused: string | null } | null;
function chipFields(v: ChipReadable): { spec: GoalSpec; turn: number; stopped: string | null; paused: string | null } | null {
  if (v === null) return null;
  return { spec: v.spec, turn: v.turn, stopped: v.stopped, paused: v.paused };
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
const paused: AgentEvent = { type: "goal_paused", reason: "用户暂停目标", turn: 2 };
const resumed: AgentEvent = { type: "goal_resumed", turn: 2 };

/** 覆盖到每一种会影响芯片读数的事件，且夹着"设→停→再设"与"设→挂→恢复/清除"的改设路径。 */
const STREAMS: AgentEvent[][] = [
  [],
  [human("没有目标的一段工作"), verifyOk],
  [G("把测试修绿"), human("第一条人发的"), goalTurn(2), ...writePair, goalTurn(3), verifyOk],
  [verifyOk, G("旧目标"), stopped, G("新目标"), goalTurn(2), promoted, goalTurn(3)],
  [G("目标", 25, 1.5), stopped, promoted, human("人的下一条")],
  // 挂起/恢复路径：挂起后恢复，轮次/目标不许被恢复重置
  [G("挂起再恢复"), goalTurn(2), paused, resumed, goalTurn(3)],
  // 挂起后被清除：停止压过挂起，两个位不许同时为真
  [G("挂起后被清"), goalTurn(2), paused, stopped],
  // 只有挂起/恢复、没有目标：与「没设过目标」一样两头都报空
  [paused, resumed],
];

describe("goal-trace：芯片与判据读同一份 reduce", () => {
  it("逐前缀复算：筛过重算 == 整段重算（芯片读的读数一字不差）", () => {
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
    // 挂起/恢复也影响芯片读数（芯片要显示"已挂起/续跑中"），必须进筛子
    expect([paused, resumed].map((e) => goalRelevant(e))).toEqual([true, true]);
  });

  it("挂起 ≠ 停止：恢复只清挂起位（不动 spec/turn/窗口），停止压过挂起（两位不并存）", () => {
    const stream = [G("目标"), goalTurn(2), paused];
    const pv = projectGoal(stream);
    expect(pv?.paused).not.toBeNull();
    expect(pv?.stopped).toBeNull();

    const rv = projectGoal([...stream, resumed]);
    expect(rv?.paused).toBeNull();
    expect(rv?.stopped).toBeNull();
    expect(rv?.turn).toBe(2); // 恢复不重置轮次（≠ 改设）
    expect(rv?.spec).toEqual(pv?.spec); // 恢复不改目标
    expect(rv?.usage).toEqual(pv?.usage); // 恢复不移动花费窗口

    // 停止是终态且压过挂起：两个「不续跑」的理由不许同时为真（否则消费者要判两处）
    const sv = projectGoal([...stream, stopped]);
    expect(sv?.stopped).not.toBeNull();
    expect(sv?.paused).toBeNull();
    // 已停的目标再点挂起：不落挂起位
    expect(projectGoal([G("目标"), stopped, paused])?.paused).toBeNull();
    // 没有已武装的目标时，挂起/恢复都不构成目标态
    expect(projectGoal([paused, resumed])).toBeNull();
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
