// 主循环的换路压力（能力 4/9）：重复调用检测器 detectStuck 过去只服务 worker 看门，
// 用户直用的这条路上「同一个失败调用重复到 maxSteps」既没闸也没提示。
// 裁决：只在那条 tool_result 尾部追加一行，不动终止语义、不新增事件、不多要一轮。
import { describe, expect, it } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import type { ModelOutput, Provider } from "../src/providers";
import type { Tool } from "../src/tools";

const tool = (ok: boolean, output: string): Tool => ({
  name: "read_file",
  async run() {
    return { ok, output };
  },
});

/** 前 n 步各吐一个 read_file 调用，第 n+1 步吐纯文本 ⇒ loop 自然收束。 */
async function run(
  n: number,
  options: Partial<LoopOptions> = {},
  argsOf: (step: number) => Record<string, unknown> = () => ({}),
): Promise<{ log: AgentEvent[]; requests: number }> {
  const log: AgentEvent[] = [];
  let step = 0;
  let requests = 0;
  const provider: Provider = {
    async *stream(): AsyncGenerator<ModelOutput> {
      requests += 1;
      step += 1;
      if (step <= n) {
        yield { type: "tool_call", id: "c" + String(step), name: "read_file", args: argsOf(step) };
      } else {
        yield { type: "assistant_message", content: "收工" };
      }
    },
  };
  await runLoop({
    provider,
    events: { async append(event) { log.push(event); } },
    workspace: "/tmp",
    userMessage: "查一下",
    ...options,
  });
  return { log, requests };
}

const results = (log: AgentEvent[]): string[] =>
  log.filter((e) => e.type === "tool_result").map((e) => (e as { output: string }).output);

describe("重复调用的换路压力（主循环，非 worker 看门）", () => {
  it("同一调用连败 3 次：提示挂在那条 tool_result 尾部，前两次一字不加", async () => {
    const { log } = await run(3, { stuckNudge: true, tools: { read_file: tool(false, "ENOENT: nope") } });
    const outs = results(log);
    expect(outs).toHaveLength(3);
    expect(outs[0]).not.toContain("[repeat]");
    expect(outs[1]).not.toContain("[repeat]");
    expect(outs[2]).toContain("[repeat]");
    expect(outs[2]).toContain("失败");
    // 提示是尾注不是改写：原判据文本仍在，且 ok 不得被翻转
    expect(outs[2]).toContain("ENOENT: nope");
    expect(log.filter((e) => e.type === "tool_result").every((e) => (e as { ok: boolean }).ok === false)).toBe(true);
  });

  it("每个 rule+action 只提示一次（第 4、5 次重复不再叠同一句话）", async () => {
    const { log } = await run(5, { stuckNudge: true, tools: { read_file: tool(false, "ENOENT: nope") } });
    expect(results(log)).toHaveLength(5);
    expect(results(log).filter((o) => o.includes("[repeat]"))).toHaveLength(1);
  });

  it("成功但逐字相同：第 3 次不提示、第 4 次才提示（阈值取自 detectStuck，不自己造数）", async () => {
    const { log } = await run(4, { stuckNudge: true, tools: { read_file: tool(true, "SAME") } });
    const outs = results(log);
    expect(outs.filter((o) => o.includes("[repeat]"))).toHaveLength(1);
    expect(outs[2]).not.toContain("[repeat]");
    expect(outs[3]).toContain("[repeat]");
    expect(outs[3]).toContain("逐字相同");
  });

  it("参数不同不算重复：连续读不同文件一个提示都不产生（正常任务零回归）", async () => {
    const { log } = await run(
      6,
      { stuckNudge: true, tools: { read_file: tool(true, "SAME") } },
      (step) => ({ path: "f" + String(step) + ".ts" }),
    );
    expect(results(log)).toHaveLength(6);
    expect(results(log).filter((o) => o.includes("[repeat]"))).toHaveLength(0);
  });

  it("缺省不开：worker / 靶场 / sidechat 那三条路径的事件流一字不动", async () => {
    // 不开的理由不是保守——追加文本会改掉 orchestrator 卡死看门比较的观察串
    // （×4 相同被打散成 ×3 + 1 条带尾注 ⇒ 看门永不触发，m3c 集成测实测到），
    // 靶场的用量还是按字节推的。所以只有主会话显式 stuckNudge: true。
    const { log } = await run(5, { tools: { read_file: tool(false, "ENOENT: nope") } });
    expect(results(log)).toHaveLength(5);
    expect(results(log).filter((o) => o.includes("[repeat]"))).toHaveLength(0);
    expect(results(log).every((o) => o === "ENOENT: nope")).toBe(true);
  });

  it("只加一行文本：不新增事件、不多要一轮请求、不改权限与 verify 语义", async () => {
    const { log, requests } = await run(5, { stuckNudge: true, tools: { read_file: tool(false, "ENOENT: nope") } });
    expect(requests).toBe(6); // 5 次工具轮 + 1 次纯文本收束轮（没被提前掐，也没多要）
    expect(log.filter((e) => e.type === "tool_call")).toHaveLength(5);
    expect(log.filter((e) => e.type === "tool_result")).toHaveLength(5);
    expect(log.filter((e) => e.type === "error")).toHaveLength(0);
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(0);
  });
});
