// 思考档位在空屏上的选择必须真的生效（2026-10-22）。
//
// 旧病灶：空屏（activeId === null）的模型芯片显示「· 思考 关」并可拨，但 onThinkingChange
// 第一行就是 `if (activeId === null) return;` —— 拨完数据不动、也没有提示；用户以为这一轮
// 用强思考，第一条消息实际按 off 发出去。判据分两半：
//   ① 纯函数把「拨一下改哪一格」定死（空屏 → pending，会话内 → 该会话）；
//   ② 接线别退回去：WorkbenchView 读 composerThinking、run-queue 建会话时 seed 新会话。
// ② 用应用外壳面（all renderer sources），不用单文件——《AGENTS.md》「断言读面」。
import { describe, expect, it } from "vitest";
import { composerThinking, isThinkingEffort, seedNewSessionThinking, thinkingChangeTarget } from "../src/renderer/state/thinking-selection";
import { readAppSurface } from "./helpers/app-surface";

describe("思考档位：空屏选择", () => {
  it("空屏显示 pending（下一条新会话的起点），不读会话 map", () => {
    expect(composerThinking(null, "high", new Map([["s1", "low"]]))).toBe("high");
  });

  it("会话内读该会话的显式选择；没有/非法值回 off（不发参数）", () => {
    const map = new Map<string, string>([["s1", "medium"], ["s2", "bogus"]]);
    expect(composerThinking("s1", "high", map)).toBe("medium");
    expect(composerThinking("s2", "high", map)).toBe("off");
    expect(composerThinking("s3", "high", map)).toBe("off");
  });

  it("拨一下：空屏改 pending，会话内改该会话；非法档位 null（不猜、不夹紧）", () => {
    expect(thinkingChangeTarget(null, "high")).toEqual({ kind: "pending", level: "high" });
    expect(thinkingChangeTarget("s1", "low")).toEqual({ kind: "session", sessionId: "s1", level: "low" });
    expect(thinkingChangeTarget(null, "max")).toBeNull();
    expect(thinkingChangeTarget("s1", undefined)).toBeNull();
    expect(isThinkingEffort("medium")).toBe(true);
    expect(isThinkingEffort("")).toBe(false);
  });

  it("新会话落成：pending=off 不写脏数据；非 off 才写", () => {
    const map = new Map<string, string>();
    seedNewSessionThinking("s1", "off", map);
    expect(map.has("s1")).toBe(false);
    seedNewSessionThinking("s2", "high", map);
    expect(map.get("s2")).toBe("high");
  });

  it("接线：芯片读 composerThinking；建会话时 seed；旧的空屏直接 return 不得复活", () => {
    const surface = readAppSurface();
    expect(surface).toContain("composerThinking(activeId, pendingThinking, thinkingBySession.current)");
    expect(surface).toContain("seedNewSessionThinking(newId, pendingThinking, thinkingBySession.current)");
    expect(surface).toContain("setPendingThinking(change.level)");
    expect(surface).not.toContain("activeId === null ? undefined : thinkingBySession.current.get(activeId)");
  });
});
