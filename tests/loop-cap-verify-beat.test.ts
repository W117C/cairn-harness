// #69 的判卷：撞 `maxSteps` 的那条路也必须留下「验过／没验过」的证据（2026-10-05 第 378 页）。
//
// **为什么单独一页**：收束闸（能力 5）原先只住在 `if (!sawToolCall)`（模型自己不再调工具）那一支里，
// 而步数用尽是从循环外面**抛出去**的 ⇒ 撞帽的 run 永远不"收束"，那一拍不可能响。
// 实测暴露面（第 369 页那批 43 份真实轨迹）：**5 份（≈12%）整趟被帽砍掉**，脚本面 0 份——
// 也就是说这一格只在真模型面上发病，而真模型面恰是花钱最多、最该有证据的那一面。
//
// 本页判四件事，正反都要有（缺了反向守卫，「拒绝一切」也能全绿）：
//   ① 撞帽 + 写过盘 + 开闸 ⇒ **恰一拍** verify 证据落流，且 run 仍然照旧抛错（不是把帽藏起来）；
//   ② 没写过盘 ⇒ 零行为（旧口径：没东西可验就不拍）；
//   ③ 仓库没可验面（surface=false）⇒ 零行为；
//   ④ 没开闸（autoVerify 不给）⇒ 零行为。
import { it, expect, describe } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";

type ModelOutput = { type: string; id?: string; name?: string; args?: Record<string, unknown>; content?: string };

const failHook = { surface: async () => true, run: async () => ({ ok: false as const, results: [] }) };

/** 剧本：**每一轮都调工具**，所以模型永远不会自己收束 ⇒ 一定撞帽。 */
async function runToCap(opts: Partial<LoopOptions> = {}, maxSteps = 3) {
  const log: AgentEvent[] = [];
  let threw: unknown = null;
  let requests = 0;
  try {
    await runLoop({
      workspace: "/tmp",
      userMessage: "一直改",
      mode: "auto",
      interactive: true,
      maxSteps,
      events: { async append(event) { log.push(event); } },
      tools: { write_file: { name: "write_file", async run() { return { ok: true, output: "written" }; } } },
      provider: {
        async *stream() {
          requests++;
          yield { type: "tool_call", id: "w" + String(requests), name: "write_file", args: { path: "a.ts" } } as unknown as ModelOutput;
        },
      },
      ...opts,
    } as LoopOptions);
  } catch (err) {
    threw = err;
  }
  return { log, threw, requests };
}

const beats = (log: AgentEvent[]) => log.filter((e) => e.type === "verify_result");

describe("撞帽路也要留证据（#69）", () => {
  it("① 撞帽 + 写过盘 + 开闸 ⇒ 恰一拍 auto 证据落流，且 run 照旧抛错（帽没被藏起来）", async () => {
    const { log, threw } = await runToCap({ verify: failHook, autoVerify: true });
    expect(beats(log), "撞帽后没有留下任何 verify 证据 ⇒ #69 复发").toHaveLength(1);
    expect(beats(log)[0]).toMatchObject({ type: "verify_result", ok: false, auto: true, attempt: 1 });
    // 「照旧抛错」这一条不能省：本条修的是**取证面**，不是把撞帽变成正常收束。
    // 若哪天有人为了让它绿而把 throw 摘掉，那条 run 的失败会被静默吞掉，比原缺陷更坏。
    expect(threw, "撞帽必须仍然抛错——补证据不等于把失败藏起来").toBeInstanceOf(Error);
    expect(String(threw)).toContain("maxSteps");
  });

  it("①b 证据拍**不偷要一轮模型调用**（与收束路同口径）", async () => {
    const { requests } = await runToCap({ verify: failHook, autoVerify: true }, 3);
    expect(requests).toBe(3); // 恰好用满帽，没有被证据拍顶成 4
  });

  it.each([
    { label: "没开闸（不给 autoVerify）", opts: { verify: failHook } },
    { label: "仓库没可验面（surface=false）", opts: { verify: { surface: async () => false, run: async () => ({ ok: false as const, results: [] }) }, autoVerify: true } },
    { label: "没给 verify 钩子", opts: { autoVerify: true } },
  ])("②③④ 零行为：$label ⇒ 撞帽也不落 verify 证据", async ({ opts }) => {
    const { log } = await runToCap(opts as Partial<LoopOptions>);
    expect(beats(log)).toHaveLength(0);
  });
});
