// 后台会话运行灯（2026-11-05 审计）：每条非终态事件都 force 整棵工作台，
// 用户切到别的会话或让定时任务在后台跑时，会按 token 频率重画 Sidebar/Composer/PaneDock。
// 口径：只有 0→1 的运行态转变需要重渲染；已在跑的后台 delta/tool/usage 不再穿透根状态。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { markBackgroundRunning, runKey } from "../src/renderer/state/session-identity";

describe("markBackgroundRunning", () => {
  it("第一次见到后台会话 ⇒ 0→1，要求一次重渲染", () => {
    const running = new Set<string>();
    const key = runKey("/workspace", "s1");
    expect(markBackgroundRunning(running, key)).toBe(true);
    expect(running.has(key)).toBe(true);
  });

  it("已在跑的后台会话再来 delta ⇒ 不再 force", () => {
    const running = new Set<string>([runKey("/workspace", "s1")]);
    expect(markBackgroundRunning(running, runKey("/workspace", "s1"))).toBe(false);
  });

  it("同 id 不同工作区各算各的", () => {
    const running = new Set<string>();
    expect(markBackgroundRunning(running, runKey("/a", "same"))).toBe(true);
    expect(markBackgroundRunning(running, runKey("/b", "same"))).toBe(true);
  });

  it("接线：session-subscription 的后台分支只在转变时 force", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/state/session-subscription.ts", import.meta.url)), "utf8");
    expect(src).toContain("markBackgroundRunning(runningSet.current, statusKey!)");
    expect(src).toContain("if (!terminal && markBackgroundRunning(runningSet.current, statusKey!)) force((n) => n + 1);");
  });
});
