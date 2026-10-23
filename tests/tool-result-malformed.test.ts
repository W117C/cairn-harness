/** 工具返回畸形结构时：**不许炸、也不许糊**（2026-10-23 实测出来的两半）。
 *
 *  缺陷形状（实测，不是推理）：工具返回 `{ok:true}`（缺 `output`）时
 *   ① `stuck.ts#stuckObservationOf` 直接 `.slice` ⇒ `TypeError: Cannot read properties of
 *      undefined (reading 'slice')` **把整轮任务打死**；
 *   ② 修掉崩溃之后，落盘的是字面量 `"undefined"` —— 模型拿到一条"有回执但读不懂"的
 *      tool_result，比明说"这条回执没有正文"更坏。
 *
 *  类型上 `ToolResult.output: string` 是必填，但那只约束**我们自己的**工具；
 *  插件工具、MCP 工具与脚本化工具都是运行期才拿到的，返回 `{ok:true}` / `output:null` /
 *  `output:{…}` 都完全可能（`base.ts` 的接口管不到跨进程边界）。
 *
 *  本组钉四件事：
 *    ① 畸形 output **不许炸整轮**（loop 正常收尾）；
 *    ② 畸形 output 的回执要**可读**（不是 `"undefined"` / `"[object Object]"`）；
 *    ③ 不同畸形要**分得开**（缺失 ≠ null ≠ 对象 ≠ 真空串）；
 *    ④ 正常字符串输出**逐字不变**（这条挡的是"为了安全把所有输出都包一层"）。
 */
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { stuckObservationOf } from "../src/agent/stuck";
import { projectContext } from "../src/agent/context";
import type { AgentEvent } from "../src/events";
import type { Provider, ProviderMessage } from "../src/providers";

/** 跑一轮：工具返回给定值，然后把**模型面看到的 tool 消息**取回来。 */
async function runOne(ret: unknown): Promise<{ threw: string; toolContent: string | undefined; events: AgentEvent[] }> {
  const events: AgentEvent[] = [];
  const requests: ProviderMessage[][] = [];
  let round = 0;
  const provider: Provider = {
    async *stream(messages) {
      requests.push(messages);
      round += 1;
      if (round === 1) yield { type: "tool_call", id: "c1", name: "t", args: {} };
      else yield { type: "assistant_message", content: "收尾" };
    },
  };
  let threw = "";
  try {
    await runLoop({
      provider,
      events: { async append(e: AgentEvent) { events.push(e); } },
      workspace: "/tmp",
      userMessage: "x",
      tools: { t: { name: "t", async run() { return ret as never; } } },
    });
  } catch (err) { threw = (err as Error).message; }
  const toolMsg = projectContext(events).find((m) => m.role === "tool");
  return { threw, toolContent: toolMsg === undefined ? undefined : String(toolMsg.content), events };
}

describe("工具返回畸形结构：不炸、不糊、分得开", () => {
  it("★ 缺 output（`{ok:true}`）⇒ 不许炸整轮，且回执可读", async () => {
    const r = await runOne({ ok: true });
    // 旧实现死在这一条：TypeError … reading 'slice'
    expect(r.threw, "一条诊断读数把整轮任务打死 = 本末倒置").toBe("");
    expect(r.toolContent).toContain("没有正文");
    expect(r.toolContent, "字面量 \"undefined\" 会被模型当成真实输出读").not.toBe("undefined");
  });

  it("★ output = null ⇒ 回执可读，且与「缺失」分得开", async () => {
    const r = await runOne({ ok: true, output: null });
    expect(r.threw).toBe("");
    expect(r.toolContent).toContain("null");
    expect(r.toolContent).not.toContain("undefined");
  });

  it("★ output = 对象 ⇒ **序列化出来**（不是 [object Object]）", async () => {
    const r = await runOne({ ok: true, output: { a: 1, b: "x" } });
    expect(r.threw).toBe("");
    expect(r.toolContent, "[object Object] 等于把回执扔了").not.toContain("[object Object]");
    expect(r.toolContent).toContain('"a":1');
  });

  it("★ 反向哨兵：正常字符串输出**逐字不变**（不许为了安全全包一层）", async () => {
    const r = await runOne({ ok: true, output: "文件读到了：42 行" });
    expect(r.toolContent).toBe("文件读到了：42 行");
  });

  it("真空串 ≠ 缺失（空串是『真的没输出』这一事实，不许被顶替成占位符）", async () => {
    const r = await runOne({ ok: true, output: "" });
    expect(r.toolContent).toBe("");
  });
});

describe("stuckObservationOf 的取料面（崩溃点本体）", () => {
  it("★ 非字符串一律不抛（旧实现 undefined.slice ⇒ TypeError）", () => {
    for (const v of [undefined, null, 42, {}, [], { a: 1 }]) {
      expect(() => stuckObservationOf(v), "stuckObservationOf(" + JSON.stringify(v) + ") 抛了").not.toThrow();
    }
  });

  it("不同畸形给出**不同**的观察串（否则「缺失」会被当成「卡在同一动作」）", () => {
    const shapes = [undefined, null, {}, ""].map((v) => stuckObservationOf(v));
    expect(new Set(shapes).size, "两种畸形折成同一个串 ⇒ 卡死判定会把它们当成重复").toBe(4);
  });

  it("正常字符串照旧截 200 字（既有口径不变）", () => {
    const long = "a".repeat(500);
    expect(stuckObservationOf(long)).toHaveLength(200);
  });

  it("环形对象不抛（JSON.stringify 会炸的那一类）", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stuckObservationOf(cyclic)).not.toThrow();
  });
});
