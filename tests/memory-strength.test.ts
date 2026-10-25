// M7 strength.ts 的判卷面：强度算术的每一支（衰减/回升/休眠判定/命中落账）都是纯函数，
// 这里钉数值语义与「算不动就保守」的失败语义。锚点用的数值（29 天半衰期、0.3 增益、
// 0.25/45 天休眠线、0.6 唤醒强度）与模块常量**同名同值**——判据读常量，不抄数字。
import { describe, expect, it } from "vitest";
import {
  DORMANT_AFTER_DAYS,
  DORMANT_STRENGTH,
  REINFORCE_GAIN,
  STRENGTH_HALF_LIFE_DAYS,
  WAKE_STRENGTH,
  bumpStat,
  daysBetweenIso,
  decayStrength,
  reinforceStrength,
  shouldDormant,
  type MemoryStat,
} from "../src/agent/memory/strength";

const T0 = "2026-10-25T00:00:00.000Z";
function daysLater(days: number): string {
  return new Date(Date.parse(T0) + days * 86_400_000).toISOString();
}
function stat(partial: Partial<MemoryStat> & Pick<MemoryStat, "lastRetrieved" | "strength">): MemoryStat {
  return { topic: partial.topic ?? "t", hits: partial.hits ?? 0, lastRetrieved: partial.lastRetrieved, strength: partial.strength, ...(partial.dormant === true ? { dormant: true } : {}) };
}

describe("daysBetweenIso", () => {
  it("整日差值；时钟倒走与非法输入 → null", () => {
    expect(daysBetweenIso(T0, daysLater(29))).toBe(29);
    expect(daysBetweenIso(T0, T0)).toBe(0);
    expect(daysBetweenIso(daysLater(1), T0)).toBeNull(); // 倒走按「算不动」处理
    expect(daysBetweenIso("not-a-date", T0)).toBeNull();
  });
});

describe("decayStrength（Ebbinghaus 半衰期）", () => {
  it("一个半衰期减半、两个减到四分之一（浮点收口到 1e-6）", () => {
    expect(decayStrength(1, T0, daysLater(STRENGTH_HALF_LIFE_DAYS))).toBe(0.5);
    expect(decayStrength(1, T0, daysLater(STRENGTH_HALF_LIFE_DAYS * 2))).toBe(0.25);
    expect(decayStrength(0.8, T0, daysLater(STRENGTH_HALF_LIFE_DAYS))).toBeCloseTo(0.4, 6);
  });
  it("锚点/当前时间非法或倒走 → 原值返回（宁可不衰减，不凭空判死）", () => {
    expect(decayStrength(0.7, "bad", T0)).toBe(0.7);
    expect(decayStrength(0.7, T0, "bad")).toBe(0.7);
    expect(decayStrength(0.7, daysLater(10), T0)).toBe(0.7);
  });
  it("越界输入夹回 [0,1]", () => {
    expect(decayStrength(2, T0, daysLater(90))).toBeLessThanOrEqual(1);
    expect(decayStrength(1, T0, daysLater(365))).toBeGreaterThanOrEqual(0);
  });
});

describe("reinforceStrength（检索练习回升）", () => {
  it("越弱升得越多、上限 1：0 → 增益值；1 → 不动", () => {
    expect(reinforceStrength(0)).toBeCloseTo(REINFORCE_GAIN, 10);
    expect(reinforceStrength(1)).toBe(1);
    expect(reinforceStrength(0.5)).toBeCloseTo(0.5 + 0.5 * REINFORCE_GAIN, 10);
    // 回升有界：连打多次也到不了 1 以上。
    let s = 0;
    for (let i = 0; i < 100; i++) s = reinforceStrength(s);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("shouldDormant（休眠双条件）", () => {
  it("又弱又久未命中 → 休眠；只满足其一 → 不休眠", () => {
    const weakOld = stat({ lastRetrieved: daysLater(0), strength: 1 });
    // 强度 1 经过 10 个半衰期 → ≈0.001，且 290 天 > 45 天 ⇒ 休眠
    expect(shouldDormant(weakOld, daysLater(STRENGTH_HALF_LIFE_DAYS * 10))).toBe(true);
    // 弱但近期命中过（锚点在 45 天内）⇒ 不休眠
    const weakRecent = stat({ lastRetrieved: daysLater(DORMANT_AFTER_DAYS - 1), strength: 0.01 });
    expect(shouldDormant(weakRecent, daysLater(DORMANT_AFTER_DAYS))).toBe(false);
    // 久未命中但强度还高（刚写不久就放了 46 天且强度仍 > 0.25——用 0.5 且半衰期内）⇒ 不休眠
    const strongOld = stat({ lastRetrieved: daysLater(0), strength: 1 });
    expect(shouldDormant(strongOld, daysLater(DORMANT_AFTER_DAYS))).toBe(false); // 45 天衰减 ≈ 0.58 > 0.25
    // 已休眠的保持休眠（幂等）
    expect(shouldDormant(stat({ lastRetrieved: T0, strength: 0.01, dormant: true }), daysLater(DORMANT_AFTER_DAYS + 1))).toBe(true);
    // 锚点非法 ⇒ daysBetweenIso null ⇒ 不休眠（保守）
    expect(shouldDormant(stat({ lastRetrieved: "bad", strength: 0.01 }), daysLater(400))).toBe(false);
  });
  it("阈值语义：衰减到恰好 DORMANT_STRENGTH 不休眠（线是「以下」），低于才休", () => {
    // 45 天后强度恰为 0.25 的初始值：0.25 × 0.5^(45/29) ≈ 0.125 < 0.25 ⇒ 休眠。
    // 反向钉「以下」语义：构造强度使衰减后恰好 = 0.25 ⇒ 不休眠。
    const from = DORMANT_AFTER_DAYS / STRENGTH_HALF_LIFE_DAYS;
    const initial = DORMANT_STRENGTH / Math.pow(0.5, from);
    expect(decayStrength(initial, T0, daysLater(DORMANT_AFTER_DAYS))).toBeCloseTo(DORMANT_STRENGTH, 6);
    expect(shouldDormant(stat({ lastRetrieved: T0, strength: initial }), daysLater(DORMANT_AFTER_DAYS))).toBe(false);
  });
});

describe("bumpStat（命中落账）", () => {
  it("首次命中建账：hits=1、强度=增益值（只被词面碰过一次不拿满强度）", () => {
    const b = bumpStat(null, "topic-a", T0);
    expect(b).toEqual({ topic: "topic-a", hits: 1, lastRetrieved: T0, strength: REINFORCE_GAIN });
  });
  it("老账：先衰减到「现在」再回升，锚点重置、命中数 +1、休眠清除", () => {
    const prev = stat({ topic: "t", hits: 3, lastRetrieved: daysLater(0), strength: 0.5 });
    const b = bumpStat(prev, "t", daysLater(STRENGTH_HALF_LIFE_DAYS));
    expect(b.hits).toBe(4);
    expect(b.lastRetrieved).toBe(daysLater(STRENGTH_HALF_LIFE_DAYS));
    expect(b.dormant).toBeUndefined();
    // 0.5 → 衰减 0.25 → 回升 0.25 + 0.75×0.3 = 0.475
    expect(b.strength).toBeCloseTo(0.475, 6);
  });
  it("休眠条目被命中 = 唤醒：强度重置到 WAKE_STRENGTH（不从衰减值回升）", () => {
    const prev = stat({ topic: "t", hits: 1, lastRetrieved: daysLater(0), strength: 0.02, dormant: true });
    const b = bumpStat(prev, "t", daysLater(365));
    expect(b.dormant).toBeUndefined();
    // 唤醒基线 0.6（衰减值 0.02 更低 ⇒ 取 0.6）再回升
    expect(b.strength).toBeCloseTo(WAKE_STRENGTH + (1 - WAKE_STRENGTH) * REINFORCE_GAIN, 6);
  });
});
