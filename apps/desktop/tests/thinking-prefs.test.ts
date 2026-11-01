// 思考档「可选面」的纯函数判卷（2026-10-31 · 业主：档位数量由用户定，默认来自上游声明）。
//
// 契约只有三条：① 只能做减法（声明表是上限，off 永远保留）；
// ② 坏 localStorage 回空（不能一次坏档让所有模型只剩「关」）；
// ③ 收起当前档时归位到模型缺省/第一可见档，显示与请求不许分叉。
import { describe, expect, it } from "vitest";
import {
  canHideThinkingLevel,
  parseThinkingHidden,
  reconcileVisibleLevel,
  serializeThinkingHidden,
  toggleThinkingHidden,
  visibleThinkingLevels,
} from "../src/renderer/state/thinking-prefs";

describe("思考档位的本机可选面", () => {
  it("坏档回空：不是「全部隐藏」", () => {
    expect(parseThinkingHidden(null)).toEqual({});
    expect(parseThinkingHidden("")).toEqual({});
    expect(parseThinkingHidden("{")).toEqual({});
    expect(parseThinkingHidden("[]")).toEqual({});
    expect(parseThinkingHidden('{"m":["low",3]}')).toEqual({});
    expect(parseThinkingHidden(serializeThinkingHidden({ m: ["low"] }))).toEqual({ m: ["low"] });
  });

  it("只做减法：声明顺序不变，off 不能被藏掉", () => {
    expect(visibleThinkingLevels(["off", "low", "high"], ["high"])).toEqual(["off", "low"]);
    expect(visibleThinkingLevels(["off", "low"], ["off"])).toEqual(["off", "low"]);
    expect(canHideThinkingLevel("off")).toBe(false);
    expect(canHideThinkingLevel("max")).toBe(true);
  });

  it("切换只认声明表里的档：未知档与 off 原样返回", () => {
    expect(toggleThinkingHidden([], "low", ["off", "low", "high"])).toEqual(["low"]);
    expect(toggleThinkingHidden(["low"], "low", ["off", "low", "high"])).toEqual([]);
    expect(toggleThinkingHidden([], "max", ["off", "low"])).toEqual([]);
    expect(toggleThinkingHidden([], "off", ["off", "low"])).toEqual([]);
  });

  it("收起当前档 ⇒ 落到模型缺省，再落到第一可见档，最后才是 off", () => {
    expect(reconcileVisibleLevel("high", ["off", "low"], "low")).toBe("low");
    expect(reconcileVisibleLevel("high", ["off", "low"], undefined)).toBe("low");
    expect(reconcileVisibleLevel("high", ["off"], "high")).toBe("off");
    expect(reconcileVisibleLevel("low", ["off", "low"], "high")).toBe("low");
  });
});
