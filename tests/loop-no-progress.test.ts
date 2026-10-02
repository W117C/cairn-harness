// M10②：把无进展阶梯接进主循环。
//
// 背景：`no-progress.ts`（248 行、5 条变异锚点、门 `no-progress-check` 判它的语料）写完之后
// **全树零生产消费者**——判据写好了没人用，等于模型"原地打转"这件事在运行时**没有任何观察者**。
// 计划书 M10 的验收原文就是「`no-progress` 有生产调用者且有判卷钉住」。
//
// 这条判卷钉三件事（每一件都对应一种"接了等于没接"的失败形状）：
//  ① 同一条验证结论连红、且中间没有任何成功的写 ⇒ **第二拍**就把 `[no-progress]` 挂在
//     模型可见的那条 tool_result 上（不是挂在事件流里没人看的字段上）；
//  ② 两拍红之间**有过成功的写** ⇒ 不算停滞（那是在换路子试）⇒ 一个字都不加；
//  ③ 绿拍 / 接线缺省 ⇒ 零行为（不许给正常任务加噪声）。
//
// 反向验证（已实跑，见 §末）：把 `verifyBeat` 里那段 `noProgressLadder` 调用摘掉 ⇒ ①② 两条红。
import { describe, expect, it } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import type { ModelOutput, Provider } from "../src/providers";
import type { Tool } from "../src/tools";

/** 恒红的验证门：两次跑给出的失败签名**逐字相同**（这正是 R1「同一条结论又红了一次」的取料形状）。 */
const redVerify = {
  async run() {
    return { ok: false, results: [{ command: "pnpm test", ok: false, output: "AssertionError: 1 !== 2" }] };
  },
};

const okTool = (name: string): Tool => ({
  name,
  async run() {
    return { ok: true, output: "ok" };
  },
});

const toolResults = (log: AgentEvent[]): string[] =>
  log.filter((e) => e.type === "tool_result").map((e) => (e as { output: string }).output);

/** 按给定剧本走：每步吐一个工具调用（`verify` 走反射循环，其余走通用块），末尾吐纯文本收束。 */
async function run(
  plan: { name: string; args?: Record<string, unknown> }[],
  options: Partial<LoopOptions> = {},
): Promise<{ log: AgentEvent[] }> {
  const log: AgentEvent[] = [];
  let step = 0;
  const provider: Provider = {
    async *stream(): AsyncGenerator<ModelOutput> {
      step += 1;
      const p = plan[step - 1];
      if (p !== undefined) {
        yield { type: "tool_call", id: "c" + String(step), name: p.name, args: p.args ?? {} };
      } else {
        yield { type: "assistant_message", content: "收工" };
      }
    },
  };
  await runLoop({
    provider,
    events: { async append(event) { log.push(event); } },
    workspace: "/tmp",
    userMessage: "修一下这个 bug",
    verify: redVerify,
    stuckNudge: true,
    ...options,
  });
  return { log };
}

describe("M10② 无进展阶梯接进主循环（no-progress.ts 的首个生产消费者）", () => {
  it("同一验证结论连红 2 次且中间无写 ⇒ 第 2 拍就把 [no-progress] 回注给模型；第 1 拍一个字不加", async () => {
    const { log } = await run([{ name: "verify" }, { name: "verify" }]);
    const outs = toolResults(log);
    expect(outs).toHaveLength(2);
    expect(outs[0]).not.toContain("[no-progress]");
    expect(outs[1]).toContain("[no-progress]");
    // 指名：判据给的是"同一条结论连红 N 次 + 点名失败面"，不是"你好像卡住了"
    expect(outs[1]).toContain("连红 2 次");
    // 尾注不是改写，且**不重发正文**：两拍逐字相同 ⇒ 走 repeatDigestNote（只注一行）+ 本笔的
    // [no-progress]；失败正文不重复出现（省 token 的语义由 tests/verify.test.ts 钉着——
    // 我第一版把 evidence 整段带上，正是被那条判卷当场抓出来的）。
    expect(outs[1]).not.toContain("AssertionError: 1 !== 2");
    expect(outs[1]).toContain("逐字相同");
    expect(log.filter((e) => e.type === "verify_result").every((e) => (e as { ok: boolean }).ok === false)).toBe(true);
  });

  it("同一 rules 组合只回注一次（第 3 拍不再叠同一句话）", async () => {
    const { log } = await run([{ name: "verify" }, { name: "verify" }, { name: "verify" }]);
    expect(toolResults(log).filter((o) => o.includes("[no-progress]"))).toHaveLength(1);
  });

  it("两拍红之间**有过成功的写** ⇒ 不算停滞（那是在换路子试），一个字都不加", async () => {
    // mode: "auto" 才能让写工具真的落盘（default 档非交互下 ask 会降成 deny，写不成功就不算"换路子"）
    const { log } = await run(
      [{ name: "verify" }, { name: "write_file", args: { path: "/tmp/x.ts" } }, { name: "verify" }],
      { mode: "auto", tools: { write_file: okTool("write_file") } },
    );
    expect(toolResults(log).filter((o) => o.includes("[no-progress]"))).toHaveLength(0);
  });

  it("绿拍零行为：验证通过就直接收束，不加任何注记", async () => {
    const { log } = await run([{ name: "verify" }], {
      verify: { async run() { return { ok: true, results: [{ command: "pnpm test", ok: true, output: "" }] }; } },
    });
    expect(toolResults(log)).toHaveLength(0);
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(1);
  });

  it("只加一行文本：不新增事件类型、不多要一轮、不改 verify 语义", async () => {
    const { log } = await run([{ name: "verify" }, { name: "verify" }]);
    // 事件类型面不许长出 `no_progress` 这类新事件（注记走的是既有的 tool_result 通道）。
    // `user_message` 是 run 的输入本身落的（不是本笔产生的）。
    const types = [...new Set(log.map((e) => e.type))].sort();
    expect(types).toEqual(["assistant_message", "tool_call", "tool_result", "user_message", "verify_result"]);
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(2);
  });
});
