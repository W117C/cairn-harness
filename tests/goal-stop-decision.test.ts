// goal 模式的数据面判卷（spec §4 G + §5 J4）。为什么这些断言长这样：
// ① 自动续跑是唯一「会自己花钱」的能力，所以每一条**停止**理由都必须可判、可命名，
//    且「价格算不出来」绝不能被读成「还没花」——那是本仓点名的「把不可知记成免费」。
// ② 「done」只认机器可查的证据（复用 W4b 的 workerVerificationEvidence 四态），
//    散文自述不算数：顶尖与普通的差距就在「能证明代码真的能跑」。
// ③ 提醒块每轮重送 ⇒ 整会话付费，帽必须锁在 token 数上（字重口径），不是字符数。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
/** hint 可以合法缺席（默认那一支就不该多说一句），所以这里返回 undefined 而不是抛。 */
function hintOf(d: GoalStop): string | undefined {
  if (d.kind !== "continue") throw new Error("期望 continue，实得 " + d.kind);
  return d.hint;
}

function decide(over: Partial<GoalDecisionInput> = {}) {
  return goalStopDecision({
    turn: 2,
    spec: SPEC,
    spentUsd: 0.02,
    evidence: "absent",
    wrote: true,
    truncated: false,
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
    const ev = "failed" as const;
    const d = decide({ turn: 8, evidence: ev });
    expect(d.kind).toBe("stop");
    expect(reasonOf(d)).toContain("已用尽而目标未达成");
    // 证据态那半边收**当场那个枚举值**而不是收字面量：写死 `toContain("failed")` 等于让
    // 任何恰好含 failed 的句子替这条断言作证（第 95 页量到 60 处副本）。
    expect(reasonOf(d)).toContain(ev);
  });

  it("美元闸：花到上限即停；**价格不可知时明写闸不生效**，只按轮次闸走", () => {
    expect(reasonOf(decide({ spentUsd: 0.5 }))).toContain("已花到（实花");
    expect(noteOf(decide({ spentUsd: null, turn: 2 }))).toContain("美元闸本次不生效");
    // 反向对照：价格未知不等于没花钱，也不等于轮次闸跟着失效——到点照样停
    expect(decide({ spentUsd: null, turn: 8 }).kind).toBe("stop");
  });

  it("没 maxUsd（闸关）时不因钱停", () => {
    expect(decide({ spec: { ...SPEC, maxUsd: 0 }, spentUsd: 999 }).kind).toBe("continue");
  });

  it("无产出可续：既没写过盘也没任何验证证据 ⇒ 停（读答型目标不该被自动续跑烧钱）", () => {
    // 旧写法收的是 `toContain("没有")`——第 95 页量到 **124 处**副本，等于恒真：
    // 换成这一支独有的整句，别的分支再说「没有…」也喂不饱它。
    expect(reasonOf(decide({ evidence: "absent", wrote: false }))).toContain("没有可验证的产出，自动续跑只会白花钱");
    // 写过盘但没验 ⇒ 属于「还没验」而不是「无事可做」，必须继续
    expect(decide({ evidence: "absent", wrote: true }).kind).toBe("continue");
  });

  it("续跑文案点名是哪一态，并指向已在上下文里的红字（不复述、不重烧 token）", () => {
    for (const evidence of ["stale", "failed", "absent"] as const) {
      expect(noteOf(decide({ evidence }))).toContain(evidence);
    }
    // stale 与 failed 的区别必须原样传给模型：一个是「验过但被后续写入作废」，一个是「验了没过」，
    // 混成一句「证据不足」就会让它去重跑一遍已经验过的东西（多花一轮真钱）。
    expect(noteOf(decide({ evidence: "stale" }))).toContain("要重新 verify 才算");
    expect(noteOf(decide({ evidence: "failed" }))).toContain("最近一次验证未通过");
  });

  // 这一条把「顶包」从计数题变成**构造题**。以前散在三个 test 文件里的 5 格都只能收 3~4 个字的片段
  // （`toContain("轮次上限")`／`("美元上限")`／`("没有")`——最后那条实测有 124 处副本），
  // 而片段撞车就是假绿：别的分支的文案只要含这几个字，断言就替一条根本没触发的闸作证。
  // 现在换成逐分支扫输入 ⇒ ①每条 stop 文案**恰好命中一条**独有句（互斥 ⇒ 张冠李戴当场红）；
  // ②每条登记的独有句都必须被某个输入打中（登记了却打不中＝装饰性表，规则 129 的第三态）；
  // ③新加一支 stop 而没登记独有句 ⇒ 那一支的文案命中 0 条 ⇒ 第一条红。
  const STOP_MARKS = {
    turns: "已用尽而目标未达成",
    usd: "已花到（实花",
    noOutput: "没有可验证的产出，自动续跑只会白花钱",
  } as const;

  it("stop 分支的文案互斥且穷尽：每条只认得自己那一支，也没有第四支逃在表外", () => {
    const reasonByInput = (over: Partial<GoalDecisionInput>): string | null => {
      const d = decide(over);
      return d.kind === "stop" ? d.reason : null;
    };
    const marks = Object.values(STOP_MARKS);
    const hitMarks = new Set<string>();
    for (const evidence of ["verified", "stale", "failed", "absent"] as const) {
      for (const wrote of [true, false]) {
        for (const truncated of [true, false]) {
          for (const gate of [{ turn: 8, spentUsd: 0.5 }, { turn: 1, spentUsd: 0.5 }, { turn: 8, spentUsd: 0.02 }, { turn: 1, spentUsd: 0.02 }]) {
            const reason = reasonByInput({ evidence, wrote, truncated, ...gate });
            if (reason === null) continue;
            const hits = marks.filter((m) => reason.includes(m));
            expect(hits.length, "停止文案要恰好命中一条独有句，实得 " + String(hits.length) + "：" + reason).toBe(1);
            hitMarks.add(hits[0]!);
          }
        }
      }
    }
    expect(Object.entries(STOP_MARKS).filter(([, m]) => !hitMarks.has(m)).map(([k]) => k)).toEqual([]);
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

describe("hint 通道：判据算出来的那句要真送到模型面前（「两头断」第 10 次防线）", () => {
  it("被收走那一支带 hint；默认那一支不带（每条续跑都多说一句 = 每轮重送的钱）", () => {
    expect(hintOf(decide({ truncated: true, wrote: false }))).toContain("没写完就被收走");
    expect(hintOf(decide({}))).toBeUndefined();
    expect(hintOf(decide({ evidence: "failed" }))).toBeUndefined();
  });

  it("goalReminder：hint 在场时**替换**证据态那句默认指令（一处只留一个指令，不追加也不双份付费）", () => {
    // 挑 failed：那一支的默认句正是「对着红字继续」，替换得掉才说明 hint 真在起作用。
    const t = goalReminder(SPEC, 2, 0.02, "failed", hintOf(decide({ truncated: true, wrote: false })));
    expect(t).toContain("没写完就被收走");
    expect(t).not.toContain("红字逐条已在上一轮上下文里");
    expect(estimateTextTokens(t)).toBeLessThanOrEqual(GOAL_REMINDER_TOKEN_CAP);
  });

  it("负控：无 hint ⇒ failed 那句默认指令逐字在场（每轮重送的块不得被顺手改掉）", () => {
    expect(goalReminder(SPEC, 2, 0.02, "failed")).toContain("红字逐条已在上一轮上下文里");
  });

  it("「对着红字改」只在该说的证据态出现：absent 与 stale 手上根本没有红字", () => {
    // 这一条是本轮的真缺陷：整块原本无论什么证据态都说同一句,
    // 于是「从没跑过验证」的那一轮拿到的是「去改红字」——把模型指向不存在的东西。
    const absent = goalReminder(SPEC, 2, 0.02, "absent");
    const stale = goalReminder(SPEC, 2, 0.02, "stale");
    expect(absent).toContain("没有任何验证记录");
    expect(absent).toContain("把验证跑起来");
    expect(absent).not.toContain("红字");
    expect(stale).toContain("已作废");
    expect(stale).toContain("重跑一次验证");
    expect(stale).not.toContain("红字");
    expect(absent).not.toBe(stale);
  });

  it("生产入口真的把 decision.hint 传进去（goalNextTurn 未导出 ⇒ 只能钉这一行的形状）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");
    expect([...src.matchAll(/goalReminder\(/g)].length).toBe(1); // 只有一个生产调用点
    const call = /goalReminder\([^)]*\)/.exec(src)?.[0] ?? "";
    expect(call, "goalNextTurn 丢了这一位 ⇒ hint 算出来没人读").toContain("decision.hint");
    // 同一个形状闸顺带管住在途 worker 那一位：goalReminder 的默认值是 0，"省略"与"传 0"行为逐字相同
    // ⇒ 变异测不出来（实测存活过），能守住它的只有"这一位必须出现在调用点"。
    expect(call, "丢了 unbookedWorkers ⇒ 提醒块永远不提本拍少算的 worker 钱").toContain("unbookedWorkers");
  });
});
