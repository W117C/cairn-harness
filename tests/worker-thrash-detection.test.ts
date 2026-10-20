// 往返抖动（R3）在**没有 stuckNudge 的那条路径**上也要判得出来
// （2026-10-19 独立评审追出的 MEDIUM-LOW）。
//
// 缺陷形状：loop 里"记这一拍"（`stuckTurns.push`）被关在 `if (opts.stuckNudge === true)` 里面
// ⇒ 编排器的 worker 那条 runLoop 不开这个开关 ⇒ worker 的 `stuckTurns` **恒为空**
// ⇒ `detectStuck` 与 `detectAlternatingThrash` 在 worker 路径上**永远判不出**：
// 同一串 A/B/A/B/A/B 的动作往返，主会话判 thrashing=true、worker 判 false（列表恒空）。
//
// 这两件事是**两件事**：「有没有得判」（历史）与「判出来了要不要说给模型听」（提示）。
// 开关只该管后者。R3 的措辞（`[no-progress]` 那句）本来就不受 stuckNudge 管
// ——所以历史上它压根没有机会在 worker 路径上出现。
import { describe, expect, it } from "vitest";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import type { ModelOutput, Provider } from "../src/providers";

/** A/B 交替、观察值也回到原值的那一串动作（R3 的形状：往返 + 观察同值）。 */
const ALTERNATING: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: "read_file", args: { path: "a.ts" } },
  { name: "grep", args: { pattern: "x" } },
  { name: "read_file", args: { path: "a.ts" } },
  { name: "grep", args: { pattern: "x" } },
  { name: "read_file", args: { path: "a.ts" } },
  { name: "grep", args: { pattern: "x" } },
];

const SAME_OUTPUT = "同一段输出";

/** 跑一轮：交替动作若干次，然后 verify 一拍（verify 是 R3/R1 的观察点）。 */
async function runAlternatingThenVerify(opts: Partial<LoopOptions> = {}): Promise<AgentEvent[]> {
  const log: AgentEvent[] = [];
  let turn = 0;
  const provider: Provider = {
    async *stream(): AsyncGenerator<ModelOutput> {
      const step = ALTERNATING[turn % ALTERNATING.length]!;
      turn += 1;
      if (turn <= ALTERNATING.length) {
        yield { type: "tool_call", id: "c" + String(turn), name: step.name, args: step.args } as unknown as ModelOutput;
        return;
      }
      // verify 只拍一次；之后是空流（空流即 loop 的终止条件，否则一路撞到 maxSteps 上限）。
      if (turn === ALTERNATING.length + 1) {
        yield { type: "tool_call", id: "v1", name: "verify", args: {} } as unknown as ModelOutput;
      }
    },
  };
  await runLoop({
    provider,
    events: { async append(event) { log.push(event); } },
    workspace: "/tmp",
    userMessage: "干活",
    mode: "auto",
    tools: {
      read_file: { name: "read_file", async run() { return { ok: true, output: SAME_OUTPUT }; } },
      grep: { name: "grep", async run() { return { ok: true, output: SAME_OUTPUT }; } },
    } as never,
    // verify 门要接上：R3/R1 的措辞是在 verify 那一拍产出的（没接 verify ⇒ 那一拍 fail-closed，
    // 根本走不到判据那一步）。
    verify: { async run() { return { ok: false, results: [{ command: "anchor-check", ok: false, output: "红" }] }; } },
    ...opts,
  });
  return log;
}

describe("R3 往返抖动：没有 stuckNudge 的那条路径也判得出来", () => {
  it("★不开 stuckNudge（编排器 worker 那条路的形状）⇒ 照样判出往返抖动并出声", async () => {
    const log = await runAlternatingThenVerify();
    const verifyResult = log.find((e) => e.type === "tool_result" && e.callId === "v1") as Extract<AgentEvent, { type: "tool_result" }> | undefined;
    expect(verifyResult, "verify 那一拍没落 tool_result").toBeDefined();
    expect(
      String(verifyResult!.output),
      "worker 路径上 R3 从来判不出（历史恒空）⇒ 同一串往返在主会话判得出、在 worker 判不出",
    ).toContain("往返");
  });

  it("对照：主会话那条路（stuckNudge=true）判得出来（这一格不许被改坏）", async () => {
    const log = await runAlternatingThenVerify({ stuckNudge: true });
    const verifyResult = log.find((e) => e.type === "tool_result" && e.callId === "v1") as Extract<AgentEvent, { type: "tool_result" }> | undefined;
    expect(String(verifyResult!.output)).toContain("往返");
  });

  it("反面对照：没有往返的那一串（同动作连做）⇒ 不出 R3 的话（别把闸变成「什么都报」）", async () => {
    const log: AgentEvent[] = [];
    let turn = 0;
    const provider: Provider = {
      async *stream(): AsyncGenerator<ModelOutput> {
        turn += 1;
        if (turn <= 4) {
          yield { type: "tool_call", id: "c" + String(turn), name: "read_file", args: { path: "a.ts" } } as unknown as ModelOutput;
          return;
        }
        if (turn === 5) {
          yield { type: "tool_call", id: "v1", name: "verify", args: {} } as unknown as ModelOutput;
        }
      },
    };
    await runLoop({
      provider,
      events: { async append(event) { log.push(event); } },
      workspace: "/tmp",
      userMessage: "干活",
      mode: "auto",
      tools: { read_file: { name: "read_file", async run() { return { ok: true, output: SAME_OUTPUT }; } } } as never,
      verify: { async run() { return { ok: false, results: [{ command: "anchor-check", ok: false, output: "红" }] }; } },
    });
    const verifyResult = log.find((e) => e.type === "tool_result" && e.callId === "v1") as Extract<AgentEvent, { type: "tool_result" }> | undefined;
    expect(String(verifyResult!.output)).not.toContain("往返");
  });
});
