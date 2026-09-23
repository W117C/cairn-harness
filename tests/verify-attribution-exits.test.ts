// P1-3 第二笔：环境红在**三处出口**都不记在模型账上（gap-fix 原话：必须写成合取，
// 三道各测各的看不见中间漏过去的那条）。
//
// 三处出口 = ① `loop` 的修复额度（`maxVerify`）② worker 的客观证据 `artifacts.verified`
// （级联升档与 bandit 奖励都由这一格驱动，是一只缝不是两只）③ `distill` 的失败轨迹摘要。
// 每个断言都配一个**同形对照**：把 cause 从 `pkg-manager` 换成 `code`，三处必须全都记上账——
// 否则"不记账"可能是因为压根没在记（恒真）。
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { workerVerificationEvidence } from "../src/agent/worker-report";
import { failureDigestFromEvents } from "../src/agent/memory/distill";
import type { VerifyOutcome } from "../src/agent/verify";
import type { AgentEvent, ToolResultEvent, VerifyResultEvent } from "../src/events";

const ENV_OUTCOME: VerifyOutcome = {
  ok: false,
  results: [{ command: "pnpm run test", ok: false, output: "[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove", cause: "pkg-manager", exitCode: 1 }],
};
const CODE_OUTCOME: VerifyOutcome = {
  ok: false,
  results: [{ command: "pnpm run test", ok: false, output: "Test Files 1 failed", cause: "code", exitCode: 1 }],
};

/** 让模型每轮自调一次 verify，跑出一条真实事件流（不是手搭 fixture——手搭的会与产品形状脱钩）。 */
async function runBeats(outcomeAt: (call: number) => VerifyOutcome): Promise<AgentEvent[]> {
  const log: AgentEvent[] = [];
  let calls = 0;
  await runLoop({
    workspace: "/tmp",
    events: { async append(event) { log.push(event); } },
    tools: {},
    provider: {
      async *stream() {
        calls += 1;
        yield { type: "tool_call", id: "v" + String(calls), name: "verify", args: {} };
      },
    },
    verify: { async run() { return outcomeAt(calls); } },
  });
  return log;
}

const verifyBeats = (log: AgentEvent[]): VerifyResultEvent[] =>
  log.filter((e): e is VerifyResultEvent => e.type === "verify_result");
/** 收窄成 ToolResultEvent[]：`AgentEvent` 联合上读 `.output` 编译不过（vitest 不做类型检查，
 *  所以这类错只能由 tsc 抓——写完测试不跑 tsc 就等于没跑判卷）。 */
const injected = (log: AgentEvent[]): ToolResultEvent[] =>
  log.filter((e): e is ToolResultEvent => e.type === "tool_result" && e.ok === false);

describe("合取：同一条环境红在三处出口都不记账", () => {
  it("环境红 ⇒ 不涨修复额度、证据不判 failed、沉淀不写「验证失败」（三件同时成立才算过）", async () => {
    const log = await runBeats(() => ENV_OUTCOME);
    // ⑴ 额度：环境拍走自己的上限（2），停因必须说清"不是代码失败"，且不许出现"已达上限"那句
    expect(verifyBeats(log)).toHaveLength(2);
    expect(injected(log).some((e) => e.output.includes("已达上限"))).toBe(false);
    expect(injected(log)[injected(log).length - 1]?.output).toContain("修复额度一次未耗");
    // ⑵ 升档/bandit：证据退回"没有可用证据"，不是 failed
    expect(workerVerificationEvidence(log)).toBe("absent");
    // ⑶ 沉淀：既不许报"次验证失败"，也不许换个名字报"verify×1（工具失败）"（同一拍有两个取料面）
    const digest = failureDigestFromEvents(log);
    expect(digest).not.toContain("次验证失败");
    expect(digest).not.toContain("工具失败");
    expect(digest).toContain("不是模型的失败");
  });

  it("同形对照：cause=code 的同一条红，三处出口全都记账（否则上面那条是恒真）", async () => {
    const log = await runBeats(() => CODE_OUTCOME);
    expect(verifyBeats(log)).toHaveLength(3);
    expect(injected(log)[injected(log).length - 1]?.output).toContain("已达上限");
    expect(workerVerificationEvidence(log)).toBe("failed");
    const digest = failureDigestFromEvents(log);
    expect(digest).toContain("次验证失败");
    expect(digest).toContain("工具失败");
  });

  it("混排：第 1 拍环境、其后都真红 ⇒ 修复额度仍是完整 3 次（共 4 拍才收口）", async () => {
    const log = await runBeats((call) => (call === 1 ? ENV_OUTCOME : CODE_OUTCOME));
    expect(verifyBeats(log)).toHaveLength(4);
    expect(injected(log)[injected(log).length - 1]?.output).toContain("已达上限");
  });
});

describe("逐出口单钉（三条变异锚点各有一条自己的用例可指，不共指合取那条）", () => {
  it("出口①：环境拍不占 maxVerify 修复额度，走自己的上限并说明停因", async () => {
    const log = await runBeats(() => ENV_OUTCOME);
    expect(verifyBeats(log)).toHaveLength(2);
    // judgment-layer §9.3 不变式 1 的原文写法：连续两拍环境红 ⇒ attempt 序列 `1,1`（不是 `1,2`）
    expect(verifyBeats(log).map((e) => e.attempt)).toEqual([1, 1]);
    expect(injected(log).some((e) => e.output.includes("已达上限"))).toBe(false);
    expect(injected(log)[injected(log).length - 1]?.output).toContain("cause=pkg-manager");
  });

  it("出口②：环境拍不把 worker 证据判成 failed（级联升档与 bandit 只由这一格驱动）", async () => {
    const log = await runBeats(() => ENV_OUTCOME);
    expect(workerVerificationEvidence(log)).toBe("absent");
  });

  it("出口③：环境拍不进失败轨迹，改成 harness 侧的一笔（两个取料面都挡）", async () => {
    const log = await runBeats(() => ENV_OUTCOME);
    const digest = failureDigestFromEvents(log);
    expect(digest).toContain("拍验证因 harness 侧原因没跑成");
    expect(digest).toContain("pkg-manager×2");
    expect(digest).not.toContain("次验证失败");
    expect(digest).not.toContain("工具失败");
  });
});

describe("证据位的次序不许被环境拍顶掉", () => {
  it("绿证据之后来一拍环境红 ⇒ 证据仍是 verified（环境拍对代码证明力为零，不该改写「最后验过什么」）", () => {
    const log: AgentEvent[] = [
      { type: "verify_result", callId: "a", ok: true, attempt: 1, maxAttempts: 3, results: [] },
      { type: "verify_result", callId: "b", ok: false, attempt: 2, maxAttempts: 3, results: [], cause: "timeout" },
    ];
    expect(workerVerificationEvidence(log)).toBe("verified");
  });

  it("绿证据之后来一拍真红 ⇒ 证据降为 failed（反向：不许把环境豁免扩成「红一律不算」）", () => {
    const log: AgentEvent[] = [
      { type: "verify_result", callId: "a", ok: true, attempt: 1, maxAttempts: 3, results: [] },
      { type: "verify_result", callId: "b", ok: false, attempt: 2, maxAttempts: 3, results: [{ command: "t", ok: false, output: "boom", cause: "code" }] },
    ];
    expect(workerVerificationEvidence(log)).toBe("failed");
  });

  it("字段缺席（老会话流）⇒ 一律按 code 记账，零行为变化", async () => {
    const log = await runBeats(() => ({ ok: false, results: [{ command: "t", ok: false, output: "legacy" }] }));
    expect(verifyBeats(log)).toHaveLength(3);
    expect(workerVerificationEvidence(log)).toBe("failed");
  });
});
