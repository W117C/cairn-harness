// 闭环 v2 批次 A2 判卷：反思位（schema 校验 + 证据门 + 规则兜底）。
// 反向验证为主：无证据不收、证据指不到事件流不收、kind 封闭集外不收、反思抛错不伤规则补丁。
import { describe, expect, it } from "vitest";
import {
  applyReflection,
  NOTE_MAX_CHARS,
  parseReflectProposals,
  reflectInstruction,
} from "../src/agent/evolution/reflect.js";
import { extractSignals } from "../src/agent/evolution/signal.js";
import { strategyPatches, type StrategyPatch } from "../src/agent/evolution/strategy-patch.js";
import type { AgentEvent } from "../src/events/index.js";

const ev = (e: Record<string, unknown>): AgentEvent => e as unknown as AgentEvent;

const events: AgentEvent[] = [
  ev({ type: "user_message", content: "任务" }),
  ev({ type: "tool_call", id: "t1", name: "read_file", args: { path: "a.ts" } }),
  ev({ type: "tool_result", callId: "t1", ok: true, output: "ok" }),
  ev({ type: "verify_result", callId: "t1", ok: false, attempt: 1, maxAttempts: 3, cause: "code", results: [] }),
  ev({ type: "verify_result", callId: "t1", ok: false, attempt: 2, maxAttempts: 3, cause: "code", results: [] }),
  ev({ type: "verify_result", callId: "t1", ok: false, attempt: 3, maxAttempts: 3, cause: "code", results: [] }),
];

describe("reflect parseReflectProposals", () => {
  it("合法产出（kind 在集合、note 有界、证据指向真实 callId）全收", () => {
    const raw = { proposals: [{ kind: "verify-escalate", note: "先跑测试定位，别再盲改配置。", evidenceCallIds: ["t1"] }] };
    const out = parseReflectProposals(raw, events);
    expect(out.refusals).toEqual([]);
    expect(out.proposals).toEqual([{ kind: "verify-escalate", note: "先跑测试定位，别再盲改配置。", evidenceCallIds: ["t1"] }]);
  });

  it("反向：证据指不到事件流 ⇒ 拒那条并点名", () => {
    const raw = { proposals: [{ kind: "verify-escalate", note: "n", evidenceCallIds: ["不存在"] }] };
    const out = parseReflectProposals(raw, events);
    expect(out.proposals).toEqual([]);
    expect(out.refusals.length).toBe(1);
    expect(out.refusals[0]).toContain("不存在");
  });

  it("反向：无证据数组 / 空 note / 集合外 kind / 顶层不是对象 ⇒ 各自拒", () => {
    expect(parseReflectProposals({ proposals: [{ kind: "goal-reconfirm", note: "n" }] }, events).proposals).toEqual([]);
    expect(parseReflectProposals({ proposals: [{ kind: "goal-reconfirm", note: "  ", evidenceCallIds: ["t1"] }] }, events).proposals).toEqual([]);
    expect(parseReflectProposals({ proposals: [{ kind: "brand-new-kind", note: "n", evidenceCallIds: ["t1"] }] }, events).proposals).toEqual([]);
    expect(parseReflectProposals("不是对象", events).refusals.length).toBe(1);
    expect(parseReflectProposals({ 没有数组: 1 }, events).refusals.length).toBe(1);
  });

  it("note 控制字符剥掉 + 超长按码点封顶", () => {
    const dirty = "前\u0000\u200B缀" + "长".repeat(NOTE_MAX_CHARS + 10);
    const out = parseReflectProposals({ proposals: [{ kind: "verify-escalate", note: dirty, evidenceCallIds: ["t1"] }] }, events);
    expect(out.proposals.length).toBe(1);
    const note = out.proposals[0]!.note;
    expect(note).not.toContain("\u0000");
    expect(note).not.toContain("\u200B");
    expect(Array.from(note).length).toBeLessThanOrEqual(NOTE_MAX_CHARS + 1); // +1 是省略号
  });
});

describe("reflect applyReflection", () => {
  it("合法产出覆盖同 kind 的 note；没被覆盖的 kind 原样（规则兜底）", () => {
    const signals = extractSignals(events);
    const rule = strategyPatches(signals);
    expect(rule.length).toBeGreaterThan(0);
    const withDrift = [...rule, { kind: "goal-reconfirm" as const, driftCount: signals.goalDriftCount, note: "规则句" }];
    const out = applyReflection(withDrift, [{ kind: "verify-escalate", note: "反思句", evidenceCallIds: ["t1"] }]);
    const escalated = out.find((p): p is Extract<StrategyPatch, { kind: "verify-escalate" }> => p.kind === "verify-escalate")!;
    expect(escalated.note).toBe("反思句");
    // 结构化字段不许被反思动：times 还是规则层派生的那个数。
    expect(escalated.times).toBe(signals.verifyFailuresByCause["code"]);
    expect(out.find((p): boolean => p.kind === "goal-reconfirm")!.note).toBe("规则句");
  });

  it("同 kind 多条产出只采纳第一条（先到先得，不拼接）", () => {
    const out = applyReflection(
      [{ kind: "goal-reconfirm", driftCount: 1, note: "旧" }],
      [
        { kind: "goal-reconfirm", note: "第一条", evidenceCallIds: ["t1"] },
        { kind: "goal-reconfirm", note: "第二条", evidenceCallIds: ["t1"] },
      ],
    );
    expect(out[0]!.note).toBe("第一条");
  });

  it("零合法产出 ⇒ 原样返回（fail-open 到规则层）", () => {
    const rule = strategyPatches(extractSignals(events));
    const out = applyReflection(rule, []);
    expect(out).toEqual(rule);
  });
});

describe("reflect reflectInstruction", () => {
  it("指令带读数摘要、现行措辞与输出契约；读数缺席不编造", () => {
    const signals = extractSignals(events);
    const patches = strategyPatches(signals);
    const text = reflectInstruction(patches, [], signals);
    expect(text).toContain("verify 失败按 cause（code×3）");
    expect(text).toContain("verify-escalate（现行措辞）");
    expect(text).toContain("evidenceCallIds");
    const none = reflectInstruction([], [], extractSignals([ev({ type: "user_message", content: "无验证" })]));
    expect(none).toContain("无");
  });
});
