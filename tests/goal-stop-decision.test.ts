// goal 模式的数据面判卷（spec §4 G + §5 J4）。为什么这些断言长这样：
// ① 自动续跑是唯一「会自己花钱」的能力，所以每一条**停止**理由都必须可判、可命名，
//    且「价格算不出来」绝不能被读成「还没花」——那是本仓点名的「把不可知记成免费」。
// ② 「done」只认机器可查的证据（复用 W4b 的 workerVerificationEvidence 四态），
//    散文自述不算数：顶尖与普通的差距就在「能证明代码真的能跑」。
// ③ 提醒块每轮重送 ⇒ 整会话付费，帽必须锁在 token 数上（字重口径），不是字符数。
import { describe, expect, it } from "vitest";
import {
  GOAL_REMINDER_TOKEN_CAP,
  GOAL_TURN_CAP_DEFAULT,
  GOAL_TURN_CAP_MAX,
  goalReminder,
  goalStopDecision,
  parseGoalSpec,
  type GoalDecisionInput,
  type GoalStop,
} from "../src/agent/goal";
import { estimateTextTokens } from "../src/agent/text-budget";

const SPEC = { objective: "把 todo-app 的失败测试修到绿", maxTurns: 8, maxUsd: 0.5 };

/** 取续跑文案；决策不是 continue 就直接抛——比 `expect(x.kind === "continue" && x.note)` 更诚实：
 *  后者在决策形状不对时会安静地断言一个 false，看不出是"文案不对"还是"根本没走续跑这条路"。 */
function noteOf(d: GoalStop): string {
  if (d.kind !== "continue") throw new Error("期望 continue，实得 " + d.kind);
  return d.note;
}
function reasonOf(d: GoalStop): string {
  if (d.kind !== "stop") throw new Error("期望 stop，实得 " + d.kind);
  return d.reason;
}

function decide(over: Partial<GoalDecisionInput> = {}) {
  return goalStopDecision({
    turn: 2,
    spec: SPEC,
    spentUsd: 0.02,
    evidence: "absent",
    wrote: true,
    ...over,
  });
}

describe("parseGoalSpec：入参收窄一律 fail-visible", () => {
  it("合法输入逐字收下，缺省美元闸 = 关", () => {
    const r = parseGoalSpec({ objective: " 修 bug ", maxTurns: 5, maxUsd: 1.25 });
    expect(r.errors).toEqual([]);
    expect(r.clamped).toEqual([]);
    expect(r.spec).toEqual({ objective: "修 bug", maxTurns: 5, maxUsd: 1.25 });
    expect(parseGoalSpec({ objective: "x", maxTurns: 3 }).spec?.maxUsd).toBe(0);
  });

  it("空目标 / 非字符串 / 整体垃圾 ⇒ spec 为 null 并点名原因（不静默给个默认目标）", () => {
    for (const raw of [{ objective: "   ", maxTurns: 3 }, { maxTurns: 3 }, { objective: 7, maxTurns: 3 }, null, "修 bug", []]) {
      const r = parseGoalSpec(raw);
      expect(r.spec).toBeNull();
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it("轮次上限越界被钳且写明钳制；小数取整；非有限数按缺省", () => {
    expect(parseGoalSpec({ objective: "x", maxTurns: 0 }).spec?.maxTurns).toBe(1);
    expect(parseGoalSpec({ objective: "x", maxTurns: -5 }).clamped.join()).toContain("轮次上限");
    const wide = parseGoalSpec({ objective: "x", maxTurns: 999 });
    expect(wide.spec?.maxTurns).toBe(GOAL_TURN_CAP_MAX);
    expect(wide.clamped.join()).toContain(String(GOAL_TURN_CAP_MAX));
    expect(parseGoalSpec({ objective: "x", maxTurns: 2.7 }).spec?.maxTurns).toBe(2);
    expect(parseGoalSpec({ objective: "x", maxTurns: Number.NaN }).spec?.maxTurns).toBe(GOAL_TURN_CAP_DEFAULT);
    expect(parseGoalSpec({ objective: "x" }).spec?.maxTurns).toBe(GOAL_TURN_CAP_DEFAULT);
  });

  it("负数/垃圾美元上限收成 0（= 闸关），但不许把缺省值反过来", () => {
    expect(parseGoalSpec({ objective: "x", maxTurns: 3, maxUsd: -2 }).spec?.maxUsd).toBe(0);
    expect(parseGoalSpec({ objective: "x", maxTurns: 3, maxUsd: "0.5" }).spec?.maxUsd).toBe(0);
    expect(parseGoalSpec({ objective: "x", maxTurns: 3, maxUsd: Number.NaN }).spec?.maxUsd).toBe(0);
    expect(SPEC.maxUsd).toBeGreaterThan(0);
  });
});

describe("goalStopDecision：done 只认绿证据，停止理由必须可命名", () => {
  it("evidence=verified ⇒ done，且优先于任何闸（已达成就不该继续花钱，也不该报成超限）", () => {
    expect(decide({ evidence: "verified", turn: 99, spentUsd: 99 })).toEqual({ kind: "done" });
  });

  it("四态里另外三态一律不放行 done", () => {
    for (const evidence of ["stale", "failed", "absent"] as const) {
      const d = decide({ evidence, wrote: true });
      expect(d.kind).toBe("continue");
    }
  });

  it("轮次上限：到点就停，理由带上当前证据态（不许只写「结束」）", () => {
    const d = decide({ turn: 8, evidence: "failed" });
    expect(d.kind).toBe("stop");
    expect(reasonOf(d)).toContain("轮次上限");
    expect(reasonOf(d)).toContain("failed");
  });

  it("美元闸：花到上限即停；**价格不可知时明写闸不生效**，只按轮次闸走", () => {
    expect(reasonOf(decide({ spentUsd: 0.5 }))).toContain("美元上限");
    expect(noteOf(decide({ spentUsd: null, turn: 2 }))).toContain("美元闸");
    // 反向对照：价格未知不等于没花钱，也不等于轮次闸跟着失效——到点照样停
    expect(decide({ spentUsd: null, turn: 8 }).kind).toBe("stop");
  });

  it("没 maxUsd（闸关）时不因钱停", () => {
    expect(decide({ spec: { ...SPEC, maxUsd: 0 }, spentUsd: 999 }).kind).toBe("continue");
  });

  it("无产出可续：既没写过盘也没任何验证证据 ⇒ 停（读答型目标不该被自动续跑烧钱）", () => {
    expect(reasonOf(decide({ evidence: "absent", wrote: false }))).toContain("没有");
    // 写过盘但没验 ⇒ 属于「还没验」而不是「无事可做」，必须继续
    expect(decide({ evidence: "absent", wrote: true }).kind).toBe("continue");
  });

  it("续跑文案点名是哪一态，并指向已在上下文里的红字（不复述、不重烧 token）", () => {
    for (const evidence of ["stale", "failed", "absent"] as const) {
      expect(noteOf(decide({ evidence }))).toContain(evidence);
    }
    // stale 与 failed 的区别必须原样传给模型：一个是「验过但被后续写入作废」，一个是「验了没过」，
    // 混成一句「证据不足」就会让它去重跑一遍已经验过的东西（多花一轮真钱）。
    expect(noteOf(decide({ evidence: "stale" }))).toContain("作废");
    expect(noteOf(decide({ evidence: "failed" }))).toContain("未通过");
  });
});

describe("goalReminder：每轮重送的块必须带帽且如实报预算", () => {
  it("含目标原文、第 N/M 轮、已花与两个闸的口径", () => {
    const t = goalReminder(SPEC, 3, 0.12, "failed");
    expect(t).toContain(SPEC.objective);
    expect(t).toContain("3/" + String(SPEC.maxTurns));
    expect(t).toContain("0.12");
    expect(t).toContain("美元上限");
  });

  it("价格不可知 ⇒ 块里说的是「未知」，不是一个美元数字", () => {
    const t = goalReminder(SPEC, 1, null, "absent");
    expect(t).toContain("未知");
    expect(t).not.toContain("$0.00");
  });

  it("超长目标原文被帽住，整块 ≤ 帽值，且截断标记在场（帽以 token 计，锁 token 数）", () => {
    const long: string = "修复历史遗留的中文长目标".repeat(400);
    const t = goalReminder({ objective: long, maxTurns: 8, maxUsd: 0.5 }, 5, 0.2, "stale");
    expect(estimateTextTokens(t)).toBeLessThanOrEqual(GOAL_REMINDER_TOKEN_CAP);
    expect(t).toContain("已截断");
    expect(estimateTextTokens(long)).toBeGreaterThan(GOAL_REMINDER_TOKEN_CAP); // 证明这条输入真能触发截断
  });

  it("短目标逐字在场（帽不该动没超的东西）", () => {
    expect(goalReminder(SPEC, 1, 0, "absent")).toContain(SPEC.objective);
  });
});
