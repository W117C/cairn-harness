// 第二十四遍「Tab 想下一条」判卷：上下文摘录（buildSuggestContext 的确定性规则）。
// 摘录是喂给单发模型的原料——只取**已成终稿**的用户/助手行（live 行还在流，不喂半截话），
// 最近 8 条、每条截 400 字、总量封顶 2000 字（超则丢最早）；空摘录 = null（调用方给提示、不硬编）。
import { describe, expect, it } from "vitest";
import {
  buildSuggestContext,
  SUGGEST_CONTEXT_MESSAGES,
  SUGGEST_CONTEXT_PER_MESSAGE,
  SUGGEST_CONTEXT_TOTAL,
} from "../src/renderer/suggest";
import type { StreamRow } from "../src/renderer/projections";

const user = (text: string): StreamRow => ({ kind: "user", text, seq: 1, round: 1 });
const assistant = (text: string, live?: boolean): StreamRow => ({
  kind: "assistant", text, live, seq: 2, eventId: 2, round: 1,
});
const tool: StreamRow = { kind: "tool", tool: "web_fetch", summary: "抓了一页", ok: true, seq: 3 };
const errorRow: StreamRow = { kind: "error", text: "boom", seq: 4 };

describe("buildSuggestContext（会话摘录）", () => {
  it("空会话 / 全是被排除的行 ⇒ null", () => {
    expect(buildSuggestContext([])).toBeNull();
    expect(buildSuggestContext([tool, errorRow])).toBeNull();
    expect(buildSuggestContext([user("  "), assistant("")])).toBeNull();
  });

  it("用户/助手带角色前缀；live 中的助手行不进摘录（半截话不喂）", () => {
    expect(buildSuggestContext([user("看看新模型"), assistant("要我接着去抓哪一页？")]))
      .toBe("用户：看看新模型\n助手：要我接着去抓哪一页？");
    expect(buildSuggestContext([user("你好"), assistant("还在打字…", true)]))
      .toBe("用户：你好");
  });

  it(`只取最近 ${String(SUGGEST_CONTEXT_MESSAGES)} 条（更早的丢）；每条截 ${String(SUGGEST_CONTEXT_PER_MESSAGE)} 字加省略号`, () => {
    const rows: StreamRow[] = [];
    for (let i = 1; i <= 10; i++) rows.push(user(`第${String(i)}句`));
    const out = buildSuggestContext(rows);
    expect(out).not.toBeNull();
    expect(out).not.toContain("第1句");
    expect(out).not.toContain("第2句");
    expect(out!.split("\n")[0]).toBe("用户：第3句");

    const long = user("长".repeat(500));
    const cut = buildSuggestContext([long]);
    expect(cut!.endsWith("…")).toBe(true);
    expect(cut!).toContain("长".repeat(SUGGEST_CONTEXT_PER_MESSAGE) + "…");
    expect(cut!.includes("长".repeat(SUGGEST_CONTEXT_PER_MESSAGE + 1))).toBe(false);
  });

  it(`总量封顶 ${String(SUGGEST_CONTEXT_TOTAL)} 字：从最早整条丢起`, () => {
    const rows: StreamRow[] = [];
    for (let i = 1; i <= 8; i++) rows.push(assistant(`第${String(i)}条` + "内".repeat(390)));
    const out = buildSuggestContext(rows);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(SUGGEST_CONTEXT_TOTAL);
    expect(out!.split("\n").length).toBeLessThan(SUGGEST_CONTEXT_MESSAGES); // 丢过整条
    expect(out).not.toContain("第1条");
    expect(out).toContain("第8条");
  });
});
