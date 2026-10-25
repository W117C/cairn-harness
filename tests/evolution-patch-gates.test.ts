// 闭环 v2 批次 A3 判卷：补丁门（证据一致性 + 同轮去重 + 有界 + 可插回放）。
// 反向验证：问题不在账上不开方、同 key 只发一条、超帽拒尾不静默截断、回放面抛错按不可判拒。
import { describe, expect, it } from "vitest";
import { gatePatches, gatePatchesSync } from "../src/agent/evolution/patch-gates.js";
import { extractSignals } from "../src/agent/evolution/signal.js";
import { MAX_PATCHES_PER_RUN } from "../src/agent/evolution/strategy-patch.js";
import type { StrategyPatch } from "../src/agent/evolution/strategy-patch.js";
import type { EvolutionSignals } from "../src/agent/evolution/signal.js";
import type { AgentEvent } from "../src/events/index.js";

const ev = (e: Record<string, unknown>): AgentEvent => e as unknown as AgentEvent;

const redRun: AgentEvent[] = [
  ev({ type: "user_message", content: "任务" }),
  ev({ type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, cause: "code", results: [] }),
  ev({ type: "verify_result", callId: "v2", ok: false, attempt: 2, maxAttempts: 3, cause: "code", results: [] }),
  ev({ type: "verify_result", callId: "v3", ok: false, attempt: 3, maxAttempts: 3, cause: "code", results: [] }),
];

const signals = extractSignals(redRun);

// 手搭信号字面量（signal.ts 头注认可的形状）：覆盖「可测且回落」那一格——
// 可测分支从事件流造不出来（要 usage 边界），纯函数门吃字面量就够了。
const measurableCalm: EvolutionSignals = {
  verifyFailuresByCause: {},
  lastVerifyFailureCause: null,
  repeatedVerifyCause: null,
  verifyOutcome: "green",
  goalDriftCount: 0,
  goalDriftMeasurable: true,
  costMeasurable: true,
  tokensPerBoundary: 3_000,
  spendAfterLastBoundary: 0,
  eventCount: 10,
};

const verifyPatch = (cause = "code"): StrategyPatch =>
  ({ kind: "verify-escalate", cause, times: signals.verifyFailuresByCause[cause] ?? 3, note: "n" });

describe("patch-gates 同步门", () => {
  it("规则补丁（由信号派生）恒过", () => {
    const out = gatePatchesSync([verifyPatch()], { signals });
    expect(out.admitted.length).toBe(1);
    expect(out.refused).toEqual([]);
  });

  it("反向：本轮跑了 verify 且该 cause 零失败 ⇒ 拒（没犯这个病不开这个方）", () => {
    const out = gatePatchesSync([verifyPatch("pkg-manager")], { signals });
    expect(out.admitted).toEqual([]);
    expect(out.refused[0]!.reason).toContain("pkg-manager");
  });

  it("接续语义：verify 没跑（读数缺席）⇒ 旧补丁照过（不可测不等于已消解）", () => {
    const noneSignals = extractSignals([ev({ type: "user_message", content: "没验证" })]);
    expect(noneSignals.verifyOutcome).toBe("none");
    const out = gatePatchesSync([verifyPatch("code")], { signals: noneSignals });
    expect(out.admitted.length).toBe(1);
  });

  it("反向：漂移可测且与补丁记数不一致 ⇒ 拒；不可测 ⇒ 旧补丁照过", () => {
    const mismatch = gatePatchesSync([{ kind: "goal-reconfirm", driftCount: 5, note: "n" }], { signals: measurableCalm });
    expect(mismatch.admitted).toEqual([]);
    expect(mismatch.refused[0]!.reason).toContain("不一致");
    // 红跑没有助手散文 ⇒ 漂移不可测：接续的 goal-reconfirm（旧读数 3 处）不据此销方。
    expect(signals.goalDriftMeasurable).toBe(false);
    const absent = gatePatchesSync([{ kind: "goal-reconfirm", driftCount: 3, note: "n" }], { signals });
    expect(absent.admitted.length).toBe(1);
  });

  it("反向：成本可测且已回落 ⇒ 拒（回落的账不挂节流方）；不可测 ⇒ 照过", () => {
    const calm = gatePatchesSync([{ kind: "cost-throttle", tokensPerBoundary: 41_000, note: "n" }], { signals: measurableCalm });
    expect(calm.admitted).toEqual([]);
    expect(calm.refused[0]!.reason).toContain("回落");
    const unmeasurable = gatePatchesSync([{ kind: "cost-throttle", tokensPerBoundary: 41_000, note: "n" }], { signals });
    expect(unmeasurable.admitted.length).toBe(1);
  });

  it("同 key 只发一条（先到先得）；同 key 灌满上限之上也只活一条——去重与上限共同成立且拒因出声", () => {
    const many: StrategyPatch[] = Array.from({ length: MAX_PATCHES_PER_RUN + 2 }, () => verifyPatch());
    const capped = gatePatchesSync(many, { signals });
    expect(capped.admitted.length).toBe(1);
    expect(capped.refused.length).toBe(MAX_PATCHES_PER_RUN + 1);
    expect(capped.refused.every((r): boolean => r.reason.includes("同轮重复"))).toBe(true);
  });

  it("反向：多 key 全合法时超帽拒尾，拒因写明上限（不静默截断）", () => {
    // 手搭多 cause 失败账（连败升级不触发即可）：五个 cause 各失败一次 ⇒ 五个不同 key 的补丁都合法。
    const multiCause: EvolutionSignals = {
      ...signals,
      verifyFailuresByCause: { "cause-a": 1, "cause-b": 1, "cause-c": 1, "cause-d": 1, "cause-e": 1 },
    };
    const patches: StrategyPatch[] = Object.keys(multiCause.verifyFailuresByCause).map(
      (cause) => ({ kind: "verify-escalate", cause, times: 1, note: "n" }) as StrategyPatch,
    );
    const out = gatePatchesSync(patches, { signals: multiCause });
    expect(out.admitted.length).toBe(MAX_PATCHES_PER_RUN);
    expect(out.refused.length).toBe(patches.length - MAX_PATCHES_PER_RUN);
    expect(out.refused.every((r): boolean => r.reason.includes("超过单跑上限"))).toBe(true);
  });
});

describe("patch-gates 回放门（可插拔）", () => {
  it("回放 ok=false ⇒ 该条拒；其余照常", async () => {
    const out = await gatePatches([verifyPatch()], { signals }, {
      replay: async () => ({ ok: false, detail: "gym 回放降分" }),
    });
    expect(out.admitted).toEqual([]);
    expect(out.refused[0]!.reason).toContain("gym 回放降分");
  });

  it("回放面抛错 ⇒ 按不可判拒（fail-closed），不放行", async () => {
    const out = await gatePatches([verifyPatch()], { signals }, {
      replay: async () => {
        throw new Error("gym 起不来");
      },
    });
    expect(out.admitted).toEqual([]);
    expect(out.refused[0]!.reason).toContain("不可判");
  });

  it("不注入回放 ⇒ 同步门原样（零行为）", async () => {
    const out = await gatePatches([verifyPatch()], { signals });
    expect(out.admitted.length).toBe(1);
  });
});
