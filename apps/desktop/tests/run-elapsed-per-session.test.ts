// 运行秒表的跨会话读数（2026-10-19 独立评审追出的真缺陷）。
//
// 缺陷形状：起点存**一个** ref（谁起跑就盖谁），而读的时候无条件取它 ⇒
// A 起跑 → 切 B → B 起跑 → 切回 A（A 还在跑）⇒ 秒表算的是 `now − B 的起点`。
// A 真实跑了 3600s 会显示成 0s。秒表是"这一轮跑了多久"的用户可见读数，读错比不读更坏。
//
// 判据落在**纯函数**上（elapsedSecondsFor）：本仓无 jsdom，交互逻辑走「纯函数 + 接线见证」两面
// （见 render-structure.test.tsx 头注）。纯函数能真跑 ⇒ 这一条不是恒真的源码断言。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { elapsedSecondsFor } from "../src/renderer/projections";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("运行秒表读数（elapsedSecondsFor）", () => {
  it("★两个会话各跑各的：A 的读数只认 A 的起点（旧实现是一个 ref ⇒ 切回 A 会读成 B 的耗时）", () => {
    const T0 = 1_000_000;
    const starts = new Map<string, number>([["A", T0], ["B", T0 + 3_600_000]]);
    const now = T0 + 3_605_000;
    // A 跑了 3605s；B 才起跑 5s。切回 A 时秒表必须显示 A 自己的耗时。
    expect(elapsedSecondsFor(starts, "A", now)).toBe(3605);
    expect(elapsedSecondsFor(starts, "B", now)).toBe(5);
  });

  it("反向对照：只有一个会话时读数正确（判据不是恒假）", () => {
    const starts = new Map<string, number>([["A", 1_000]]);
    expect(elapsedSecondsFor(starts, "A", 61_000)).toBe(60);
  });

  it("没有会话 / 没有起点 ⇒ 0s（不编一个假起点）", () => {
    expect(elapsedSecondsFor(new Map(), null, 5_000)).toBe(0);
    expect(elapsedSecondsFor(new Map(), "A", 5_000)).toBe(0);
    expect(elapsedSecondsFor(new Map([["A", 1_000]]), null, 5_000)).toBe(0);
  });

  it("起点在将来（时钟回拨）⇒ 不给负数", () => {
    const starts = new Map<string, number>([["A", 10_000]]);
    expect(elapsedSecondsFor(starts, "A", 5_000)).toBe(0);
  });
});

describe("运行秒表接线：起点按会话存，不用单个 ref", () => {
  const app = readAppSurface();

  it("起点存在**按会话**的表里（与 runGen 同一形状）", () => {
    expect(app).toContain("const runStartBySession = useRef(new Map<string, number>());");
    expect(app).toContain("runStartBySession.current.set(sid, Date.now());");
    // 反面对照：单个 ref 那种形状不许回来
    expect(app).not.toContain("runStartRef");
  });

  it("秒表读数走 elapsedSecondsFor（当前会话那一格），依赖里带 activeId（切会话要重算）", () => {
    expect(app).toContain("elapsedSecondsFor(runStartBySession.current, activeId, Date.now())");
    expect(app).toContain("}, [runningActive, activeId]);");
  });

  it("这一轮收掉时起点跟着收（收之前判代际：新 run 已起跑时不许删它的起点）", () => {
    expect(app).toContain("if ((runGen.current.get(sid) ?? 0) === myGen) runStartBySession.current.delete(sid);");
  });
});
