// 主循环的换路压力（能力 4/9）：重复调用检测器 detectStuck 过去只服务 worker 看门，
// 用户直用的这条路上「同一个失败调用重复到 maxSteps」既没闸也没提示。
// 裁决：只在那条 tool_result 尾部追加一行，不动终止语义、不新增事件、不多要一轮。
import { describe, expect, it } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import { detectStuck } from "../src/agent/stuck";
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
    expect(outs[3]).toContain("相同结果（比对取前 200 字）");
    expect(outs[3]).not.toContain("逐字相同");   // 第 313 页：比的是截断摘要，"逐字"是越界措辞
    expect(outs[3]).toContain("换一个探针或说明为何仍需重复");   // 那句的"出路"半句也要有证人（第 311 页那张表点过这一格）
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

  it("换过动作再回到同一调用 ⇒ 重复段重新计，会再提示一次（不是一 run 只提示一次）", async () => {
    // a×3 失败（第 3 条提示）→ b 一次 → a×3 失败 ⇒ 第二段的第 3 条也必须提示：
    // 提示帽按「重复段」解除，否则第一次忽略就永远再也叫不醒。
    const plan: Record<string, unknown>[] = [
      { path: "a" }, { path: "a" }, { path: "a" }, { path: "b" }, { path: "a" }, { path: "a" }, { path: "a" },
    ];
    const log: AgentEvent[] = [];
    let step = 0;
    await runLoop({
      provider: {
        async *stream(): AsyncGenerator<ModelOutput> {
          step += 1;
          if (step <= plan.length) yield { type: "tool_call", id: "c" + String(step), name: "read_file", args: plan[step - 1]! };
          else yield { type: "assistant_message", content: "收工" };
        },
      },
      events: { async append(event) { log.push(event); } },
      workspace: "/tmp",
      userMessage: "查一下",
      stuckNudge: true,
      tools: { read_file: tool(false, "ENOENT: nope") },
    });
    const flagged = results(log).map((o, i) => (o.includes("[repeat]") ? i : -1)).filter((i) => i >= 0);
    expect(flagged).toEqual([2, 6]);
  });

  it("只加一行文本：不新增事件、不多要一轮请求、不改权限与 verify 语义", async () => {
    const { log, requests } = await run(5, { stuckNudge: true, tools: { read_file: tool(false, "ENOENT: nope") } });
    expect(requests).toBe(6); // 5 次工具轮 + 1 次纯文本收束轮（没被提前掐，也没多要）
    expect(log.filter((e) => e.type === "tool_call")).toHaveLength(5);
    expect(log.filter((e) => e.type === "tool_result")).toHaveLength(5);
    expect(log.filter((e) => e.type === "error")).toHaveLength(0);
    expect(log.filter((e) => e.type === "verify_result")).toHaveLength(0);
  });

  /* 第 313 页：连败三次的提示从前只看「动作相同＋全失败」，就断言「原样重试不会改变结果」。
     那句是**预测**，而检测器比的是**历史**：三次错误各不相同（flaky 测试、超时、竞态）时它为假，
     而它恰好会把"该再看一次"的那次重试劝掉——能力 5 里最贵的一种错。
     现在文案只声称检测器真比过的那件事，两态各自有名。 */
  it("连败三次而每次错误不同 ⇒ 提示不再断言重试无效，改说最新那条本身就是新信息", async () => {
    let call = 0;
    const varying: Tool = {
      name: "read_file",
      async run() {
        call += 1;
        return { ok: false, output: "FAIL run " + String(call) + ": different reason each time" };
      },
    };
    const { log } = await run(3, { stuckNudge: true, tools: { read_file: varying } });
    const outs = results(log);
    expect(outs[2], "三次同 action 全失败仍该提示：\n" + outs[2]).toContain("[repeat]");
    expect(outs[2]).toContain("每次错误不同");
    // 关键那一格：不许再说重试不会改变结果（也不许借 no-progress 那句同义出口绕过）
    expect(outs[2]).not.toContain("不会改变结果");
    expect(outs[2]).not.toContain("不会改变结论");
    // 也不许把"劝退"写成"必须重试"：只让它去读最新那条错误
    expect(outs[2]).toContain("先读它");
  });

  it("连败三次且错误相同 ⇒ 才说得出「原样重试不会改变结果」，并写明比对窗口", async () => {
    const { log } = await run(3, { stuckNudge: true, tools: { read_file: tool(false, "ENOENT: nope") } });
    const line = results(log)[2]!;
    expect(line).toContain("错误相同");
    expect(line).toContain("比对取前 200 字");   // 不说"逐字"：比的确实是截断摘要（`stuckObservationOf`）
    expect(line).toContain("原样重试不会改变结果");
    expect(line).not.toContain("逐字");
  });

  it("两次错误只差在第 201 字 ⇒ 仍算'错误相同'（这是截断比较的准确含义，文案不越过它说话）", async () => {
    const head = "E".repeat(200);
    let call = 0;
    const tailDiffers: Tool = {
      name: "read_file",
      async run() { call += 1; return { ok: false, output: head + (call === 1 ? "-a" : "-b") }; },
    };
    const { log } = await run(3, { stuckNudge: true, tools: { read_file: tailDiffers } });
    const line = results(log)[2]!;
    expect(line).toContain("错误相同（比对取前 200 字）");
    expect(line).toContain("原样重试不会改变结果");
    // 反过来钉住"我们没在看第 201 字"：两次输出确实不同，而提示按窗口说相同 ⇒ 窗口是唯一真相
    expect(new Set(results(log).map((o) => o.replace(/\n\[repeat\][\s\S]*/u, ""))).size, "三次输出应两两不同")
      .toBe(2);
  });

  it("detector 层：`sameObservation` 交的是比过的事，不是推测（阈值走配置，不自己造数）", () => {
    const t = (action: string, observation: string, ok: boolean) => ({ action, observation, ok });
    const diff = detectStuck([t("a", "x", false), t("a", "y", false), t("a", "z", false)]);
    expect(diff.stuck, JSON.stringify(diff)).toBe(true);
    expect(diff.stuck && diff.sameObservation, "错误各不相同却报'相同'＝假话").toBe(false);
    const same = detectStuck([t("a", "x", false), t("a", "x", false), t("a", "x", false)]);
    expect(same.stuck && same.sameObservation).toBe(true);
    // 规则一按定义成立（它比的就是 observation）
    const obs = detectStuck([t("a", "x", true), t("a", "x", true), t("a", "x", true), t("a", "x", true)]);
    expect(obs.stuck && obs.rule === "same_action_obs_x4" && obs.sameObservation, JSON.stringify(obs)).toBe(true);
  });
});
