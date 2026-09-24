/** 注册表判定只能看**本会话的工具表**（`opts.tools ?? TOOLS`），不许拿静态 `TOOLS` 当唯一源。
 *
 *  为什么只钉这一条：能力 26 的 L1 主张是「把"名字注册了吗"提到权限门之前」。实测之后它在本仓
 *  **不是一个可观测的缺陷**（`00-主张与判据.md` §七 记了四条读数）：
 *    ① 假名在 read-only / default / auto 三档都拿 `allow` ⇒ 今天没有被"错误放行"的证据；
 *    ② 执行前那句 `(opts.tools ?? TOOLS)[name]` 已经把幻觉调用挡住了 ⇒ 前置只换回执文案；
 *    ③ 权限规则按**精确名**匹配（`ruleApplies`），拿"给假名写一条 deny"造不出可观测差异；
 *    ④ 主循环的可执行工具表里没有 `mcp__*` 形态的名字（那种名只出现在 model-surface 的夹具里）。
 *  所以这里钉的是"前置那一格**将来**必须满足的性质"：判据若换成静态 `TOOLS`，
 *  运行期注入的工具（`installAppTools` / worker 表 / 本测这张表）会当场被误拒——
 *  这是本仓点过名的形状（「模型看得见、一调就 unknown tool」，见 worker-impact-query.test.ts）。
 */
import { describe, expect, it } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import type { Provider } from "../src/providers";

describe("注册表判定只看本会话工具表", () => {
  it("opts.tools 里注入的名字照样执行（拿静态 TOOLS 当唯一源就会误拒）", async () => {
    const log: AgentEvent[] = [];
    let ran = 0;
    let calls = 0;
    const provider: Provider = {
      async *stream() {
        calls++;
        if (calls === 1) yield { type: "tool_call", id: "p1", name: "injected_only", args: {} } as never;
      },
    };
    const opts: LoopOptions = {
      provider,
      events: { async append(e) { log.push(e); } },
      workspace: "/tmp",
      userMessage: "调一个只存在于本会话表里的工具",
      tools: {
        injected_only: {
          name: "injected_only" as never,
          async run() { ran++; return { ok: true, output: "INJECTED_RAN" }; },
        },
      },
    };
    await runLoop(opts);
    expect(ran, "被误拒 = 这道判定拿的是静态表，运行期注入的工具全废").toBe(1);
    expect(log.filter((e) => e.type === "tool_result")[0]?.output).toContain("INJECTED_RAN");
    expect(log.filter((e) => e.type === "tool_result")[0]?.output).not.toContain("unknown tool");
  });
});
