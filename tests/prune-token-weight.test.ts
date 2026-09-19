// prune 的三处 token 计量（保护区累计 / 最小修剪闸 / savedTokens 读数）此前一律 chars/4：
// 中文段一字≈一 token ⇒ 低估 4 倍。后果不是"数字难看"而是**修剪根本不触发**——保护区按低估的
// token 从最新回退，中文会话里它一口吞掉 4 倍量的事件 ⇒ 候选为空 ⇒ why="none"，那些几万字节的
// 旧中文结果永远留在上下文里每轮重付；而 savedTokens 是报给人看的成本读数，低估 4 倍=虚报省了多少。
// 判据：中文语料必须真的剪得动、读数落在字重口径上；纯 ASCII 必须逐字不变（零回归）。
import { describe, expect, it } from "vitest";
import { computePrune } from "../src/agent/prune";
import type { AgentEvent } from "../src/events";

const round = (tag: string, output: string): AgentEvent[] => [
  { type: "user_message", content: tag },
  { type: "tool_call", id: tag, name: "read_file", args: { path: "a.ts" } },
  { type: "tool_result", callId: tag, ok: true, output },
];
const cjk = (n: number): string => "中".repeat(n);
const ascii = (n: number): string => "A".repeat(n);
// 每轮 = 3 个事件：user_message(0) tool_call(1) tool_result(2) ⇒ 第 k 轮的结果在索引 3k+2
const fourCJKRounds = (): AgentEvent[] => [
  ...round("r1", cjk(1200)), ...round("r2", cjk(1200)), ...round("r3", cjk(1200)), ...round("r4", cjk(1200)),
];

describe("prune 的 token 计量按字重（能力 9 成本面）", () => {
  it("中文结果剪得动，且 savedTokens 落在字重口径（旧口径下保护区吞掉全部 ⇒ 候选空 ⇒ 永不修剪）", () => {
    const r = computePrune({ events: fourCJKRounds(), config: { protectTokens: 2000, minimumTokens: 500, recentRounds: 1 } });
    expect(r.why).toBe("saved");
    expect(r.replacements.size).toBe(2); // 最旧两轮的结果
    expect(r.savedTokens).toBeGreaterThanOrEqual(2300); // 2 × (1200 − 占位 9)
    expect(r.savedTokens).toBeLessThanOrEqual(2450);
  });

  it("纯 ASCII 逐字不变：读数仍是 ceil(chars/4) − ceil(占位/4)", () => {
    const events: AgentEvent[] = [
      ...round("r1", ascii(4000)), ...round("r2", ascii(4000)), ...round("r3", ascii(4000)), ...round("r4", ascii(4000)),
    ];
    const r = computePrune({ events, config: { protectTokens: 1000, minimumTokens: 500, recentRounds: 1 } });
    expect(r.why).toBe("saved");
    expect(r.replacements.size).toBe(3); // 保护区只到最新那条，其余三轮的结果都在区外
    expect(r.savedTokens).toBe(3 * (1000 - 9)); // 占位串 33 字符 → 9 token
  });

  it("最小修剪闸单独一条：窗口由 ASCII 撑住（两口径同界），候选是中文 ⇒ 旧口径误报 too-small 而长期不剪", () => {
    const events: AgentEvent[] = [
      ...round("r1", cjk(1500)), ...round("r2", cjk(1500)), ...round("r3", ascii(20000)),
    ];
    const r = computePrune({ events, config: { protectTokens: 5200, minimumTokens: 1000, recentRounds: 1 } });
    expect(r.why).toBe("saved");
    expect(r.savedTokens).toBeGreaterThanOrEqual(1400);
  });
});
