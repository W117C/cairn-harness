import { describe, expect, it } from "vitest";
import { gateToolSpecs } from "../src/agent/glm-session";
import type { GlmMessage } from "../src/providers/glm";
import {
  breakByFoldingVolatileIntoHead,
  breakByMiddleSplice,
  cacheableFace,
  cacheableSurvivesVolatileChange,
  historyPurelyAppends,
  lcpChars,
  oversizedFaceIsDeterministic,
  prefixChurn,
  serializeLayer,
  toolFaceChangeIsNamed,
  volatileSystemLayer,
  type AssemblyObservation,
} from "../src/agent/prefix-churn";
import { runChurnSelfTest } from "../scripts/prefix-churn-check";

const BASE = "固定基础提示";
const obs = (opts: {
  history: number;
  volatile?: string;
  tools?: string[];
  faceNote?: string;
}): AssemblyObservation => {
  const msgs: GlmMessage[] = [{ role: "system", content: BASE }];
  if (opts.volatile !== undefined) msgs.push({ role: "system", content: opts.volatile });
  for (let i = 0; i < opts.history; i++) msgs.push({ role: "user", content: "m" + String(i) });
  const specs = gateToolSpecs().slice(0, opts.tools?.length ?? gateToolSpecs().length);
  return { messages: msgs, tools: specs, faceNote: opts.faceNote ?? "" };
};

describe("前缀抖动：纯函数", () => {
  it("serializeLayer 去掉数组尾 ⇒ 纯追加时上一轮整串就是本轮的前缀", () => {
    const a = serializeLayer([{ x: 1 }]);
    const b = serializeLayer([{ x: 1 }, { y: 2 }]);
    expect(a.endsWith("]")).toBe(false);
    expect(b.startsWith(a)).toBe(true);
    expect(lcpChars(a, b)).toBe(a.length);
  });

  it("prefixChurn 把「重写」与「新增」分开记（只有 rewroteChars 才是自伤的缓存重写）", () => {
    const prev = serializeLayer([{ a: 1 }, { b: 2 }]);
    const curAppend = serializeLayer([{ a: 1 }, { b: 2 }, { c: 3 }]);
    const pure = prefixChurn(prev, curAppend);
    expect(pure.pureAppend).toBe(true);
    expect(pure.rewroteChars).toBe(0);
    expect(pure.appendChars).toBeGreaterThan(0);
    // 中段改一个字 ⇒ 从那一位起全废
    const curRewrite = serializeLayer([{ a: 1 }, { b: 22 }, { c: 3 }]);
    const churned = prefixChurn(prev, curRewrite);
    expect(churned.pureAppend).toBe(false);
    expect(churned.rewroteChars).toBeGreaterThan(0);
    expect(churned.stableChars).toBeLessThan(prev.length);
  });

  it("分层口径与装配探针同源：可缓存面 = 首条 system + 工具面，其余 system 归易变面", () => {
    const one = obs({ history: 2, volatile: "MEM-1" });
    expect(cacheableFace(one.messages, one.tools)).toBe(serializeLayer([one.messages[0], one.tools]));
    expect(volatileSystemLayer(one.messages)).toContain("MEM-1");
    expect(volatileSystemLayer(one.messages)).not.toContain(BASE);
    expect(volatileSystemLayer(obs({ history: 1 }).messages)).toBe(serializeLayer([]));
  });
});

describe("前缀抖动：四条判据各自可红", () => {
  it("PC1 纯追加真、中间摘假、无相邻对时判红（无分辨力不许当通过）", () => {
    const clean = [obs({ history: 1 }), obs({ history: 2 }), obs({ history: 3 })];
    expect(historyPurelyAppends(clean).ok).toBe(true);
    const spliced = [...clean.slice(0, 2), { ...clean[2]!, messages: breakByMiddleSplice(clean[1]!.messages) }];
    expect(historyPurelyAppends(spliced).ok).toBe(false);
    expect(historyPurelyAppends([clean[0]!]).ok).toBe(false);
  });

  it("PC2 易变块变了但可缓存面不动 = 过；把易变文本折进首条 = 红", () => {
    const varied = [obs({ history: 1, volatile: "V-1" }), obs({ history: 2, volatile: "V-22" })];
    expect(cacheableSurvivesVolatileChange(varied).ok).toBe(true);
    // 折进首条之后，两轮的可缓存面必须不同（这才是 PC2 拦的东西）
    const folded = varied.map((o) => ({ ...o, messages: breakByFoldingVolatileIntoHead(o.messages) }));
    expect(new Set(folded.map((o) => cacheableFace(o.messages, o.tools))).size).toBe(2);
    expect(cacheableSurvivesVolatileChange(folded).ok).toBe(false);
  });

  it("PC2 的「无分辨力」本身判红：易变块整轮不变时不许报通过", () => {
    const still = [obs({ history: 1, volatile: "SAME" }), obs({ history: 2, volatile: "SAME" })];
    expect(cacheableSurvivesVolatileChange(still).ok).toBe(false);
    expect(cacheableSurvivesVolatileChange(still).detail).toContain("无分辨力");
  });

  it("PC3 变了且点名 = 过；变了不点名 = 红；一次都没变 = 红（无分辨力）", () => {
    const named = [
      obs({ history: 1, tools: ["a", "b", "c", "d"] }),
      obs({ history: 2, tools: ["a", "b", "c"], faceNote: "[skill 工具面] 已摘除 d" }),
    ];
    expect(toolFaceChangeIsNamed(named).ok).toBe(true);
    expect(toolFaceChangeIsNamed([{ ...named[1]!, faceNote: "" }, named[1]!]).ok).toBe(false);
    expect(toolFaceChangeIsNamed([named[0]!, named[0]!]).ok).toBe(false);
  });

  it("PC4 同一份超限面装配多次必须逐字同一；遍历顺序一抖就红", () => {
    const specs = gateToolSpecs();
    expect(oversizedFaceIsDeterministic((round) => (round === 0 ? specs : [...specs]), 3).ok).toBe(true);
    expect(oversizedFaceIsDeterministic((round) => specs.slice(0, specs.length - round), 3).ok).toBe(false);
  });
});

describe("前缀抖动：门的反向对照", () => {
  it("--self-test 五条全部造得红（有一条造不红就说明那条判据是摆设）", () => {
    const r = runChurnSelfTest();
    expect(r.missed).toEqual([]);
    expect(r.caught.length).toBe(5);
  });
});
