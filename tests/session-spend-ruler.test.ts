// 判卷 · 会话美元闸的尺（能力 7「高风险操作要有限制」× 能力 9「成本可观测」的交点）
//
// 实测到的形状（2026-09-23 探针）：两把美元闸（`Orchestrator.budgetEstimateUsd` 与 agent-runner 的
// goal 美元闸）都按「**全部 token × 会话那一档的单价**」算花费，而 worker 可以跑在别的档位上
// （路由选档 / cascade 升档 / 显式 args.model）。本仓价表里同一份用量：
//   glm-flash $0.0202 · glm-standard $0.2020 · glm-strong $0.8080（100k in + 1k out）
// ⇒ 会话档=flash、钱实际花在 strong 时，闸读到的数是实付的 **1/40**：用户设的 $1 上限
//   最坏要实际花到几十美元才拦得下来，而**同一屏的 worker 回执报的是真价**（两把尺并存）。
// 这一族要钉的不是"算得准不准"，是**限制类判据不许和它对要限制的那个读数额外分叉**。
//
// 冻结剧本（scriptedWorkerModel）在这条路上不产生钱（W3② 既定语义：回放不冒充实付），
// 所以本文件自己写一个 `realishModel`（同形但不打 scripted 标）来代表真付钱那条路。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator } from "../src/agent/orchestrator";
import { bucketsSpendUsd, priceForModel } from "../src/agent/orchestrator-join";
import type { ModelOutput } from "../src/providers";
import type { WorkerModel } from "../src/agent/worker-model";

let work = "";
let logPath = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "session-spend-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

/** 真付钱那条路的剧本：与 scriptedWorkerModel 同形，但**不带 scripted 自述标** ⇒ 有价。 */
function realishModel(script: ModelOutput[]): WorkerModel {
  let cursor = 0;
  return async function* () {
    while (cursor < script.length) yield script[cursor++] as ModelOutput;
  };
}

function makeOrch(model: WorkerModel, budget: { maxUsd: number; pricePerMTok: number; priceModel: string }): {
  orch: Orchestrator;
  events: AgentEvent[];
} {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: work,
    parentMode: "default",
    budget,
    modelFor: () => model,
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
  });
  return { orch, events };
}

const REPORT: ModelOutput = { type: "assistant_message", content: "## 结论\n- 完成了。\n\n## 证据路径\n- a.ts:1\n\n## 风险\n- 低。\n\n## 未决问题\n- 无。" };
/** 100k in + 1k out：价表里 flash=$0.0202 / standard=$0.2020 / strong=$0.8080。 */
const HEAVY: ModelOutput = { type: "usage", inputTokens: 100_000, outputTokens: 1_000 };

async function settle(orch: Orchestrator): Promise<void> {
  await orch.waitAll(20_000);
}

describe("会话美元闸按每桶真实档位计价", () => {
  it("会话档=flash、worker 档=standard：worker 一份重活就把上限花完 ⇒ 下一次 spawn 被拒", async () => {
    // 上限 $0.10：worker 真价 $0.2020 ⇒ 必须拦。旧尺把这份 token 读成 flash 的 $0.0202 ⇒ 不拦。
    const { orch } = makeOrch(realishModel([HEAVY, REPORT]), { maxUsd: 0.1, pricePerMTok: 0, priceModel: "glm-5.3-flash" });
    const first = await orch.spawn({ mode: "read", task: "重活一", model: "glm-5.2" }, { callId: "b-1" });
    expect(first.ok, first.output).toBe(true);
    await settle(orch);
    expect(orch.budgetEstimateUsd(), "闸估价必须到 worker 那一档的价").toBeGreaterThanOrEqual(0.1);
    const second = await orch.spawn({ mode: "read", task: "重活二" }, { callId: "b-2" });
    expect(second.ok, "钱已花过上限还放新 worker ⇒ 这道闸形同虚设").toBe(false);
    expect(second.output).toContain("成本");
  });

  it("反向那一半：worker 档比会话档便宜 ⇒ 尺跟着降，不再把便宜档的 token 按会话价高估到白拦", async () => {
    // 会话档=strong（贵），worker 实际跑 flash（便宜 40 倍）。上限 $0.5：真价 $0.0202 ⇒ 不该拦。
    const { orch } = makeOrch(realishModel([HEAVY, REPORT]), { maxUsd: 0.5, pricePerMTok: 0, priceModel: "glm-5.2-pro" });
    const first = await orch.spawn({ mode: "read", task: "轻活", model: "glm-5.3-flash" }, { callId: "c-1" });
    expect(first.ok, first.output).toBe(true);
    await settle(orch);
    const second = await orch.spawn({ mode: "read", task: "再来一条轻活", model: "glm-5.3-flash" }, { callId: "c-2" });
    expect(second.ok, "worker 跑的是便宜档 ⇒ 不该被会话那一档的贵价顶死").toBe(true);
    await settle(orch);
  });

  it("主会话那一桶与 worker 那一桶各算一次：不漏 main，也不因为拆桶而双计", async () => {
    // 会话档 = standard（$0.2020 / 100k+1k）。主会话一份 + worker 一份 ⇒ 应当正好两份 = $0.4040。
    //   · 漏算主会话 ⇒ 0.202；把总量又当主会话量 ⇒ 0.606。两个方向都有人看着。
    const { orch } = makeOrch(realishModel([HEAVY, REPORT]), { maxUsd: 5, pricePerMTok: 0, priceModel: "glm-5.2" });
    expect(orch.budgetEstimateUsd()).toBe(0); // 还没用量 ⇒ 真 0（不是"算不出"）
    const r = await orch.spawn({ mode: "read", task: "各花一份", model: "glm-5.2" }, { callId: "d-1" });
    expect(r.ok, r.output).toBe(true);
    await settle(orch);
    await orch.appendProtocol({ type: "usage", inputTokens: 100_000, outputTokens: 1_000 } as AgentEvent); // 无 agent_id = 主会话自己那一跳
    expect(orch.budgetEstimateUsd(), "主会话的 token 必须进账（拆桶不是把 main 丢掉）").toBeCloseTo(0.404, 4);
  });

  it("冻结回放的 token 不冒充实付：全脚本 ⇒ 闸读数 0 且不告警（价不可知才要出声）", async () => {
    const { scriptedWorkerModel } = await import("../src/agent/orchestrator");
    const { orch } = makeOrch(
      scriptedWorkerModel([HEAVY, REPORT] as unknown as Parameters<typeof scriptedWorkerModel>[0]) as unknown as WorkerModel,
      { maxUsd: 0.1, pricePerMTok: 0, priceModel: "glm-5.3-flash" },
    );
    const r = await orch.spawn({ mode: "read", task: "回放演练", model: "glm-5.2" }, { callId: "e-1" });
    expect(r.ok, r.output).toBe(true);
    await settle(orch);
    expect(orch.budgetEstimateUsd(), "回放不产生真钱 ⇒ 不该被当成实付顶住上限").toBe(0);
    expect(orch.budgetBlocked()).toBe(false);
  });
});

/* 尺本体的三态契约。数字 literals 取自**当前**价表（未标定占位）：
 * 价表一旦重新标定，这一格必须重读后改数——它是判据，不是常量装饰。 */
describe("bucketsSpendUsd（每桶按自己那一档折）", () => {
  const HEAVY_USAGE = { inputTokens: 100_000, outputTokens: 1_000 };
  const FLASH = priceForModel("glm-5.3-flash");
  const STANDARD = priceForModel("glm-5.2");
  const STRONG = priceForModel("glm-strong");

  it("混合档位 = 两档之和，既不是全按会话档也不是全按最贵档", () => {
    const s = bucketsSpendUsd([
      { usage: HEAVY_USAGE, price: FLASH },
      { usage: HEAVY_USAGE, price: STRONG },
    ]);
    expect(s).not.toBeNull();
    expect(s!.usd).toBeCloseTo(0.0202 + 0.808, 6);
    // 成对判两侧：旧尺（全按会话 flash 档）会读成 0.0404，全按强档会读成 1.616
    expect(s!.usd).not.toBeCloseTo(0.0202 + 0.0202, 6);
    expect(s!.usd).not.toBeCloseTo(0.808 + 0.808, 6);
    expect(s!.unpricedTokens).toBe(0);
  });

  it("真实但价不可知的一桶：不折成 $0，token 计入 unpricedTokens，已知的部分照算", () => {
    const s = bucketsSpendUsd([
      { usage: HEAVY_USAGE, price: FLASH },
      { usage: HEAVY_USAGE, price: { model: "神秘档-9000", priceId: undefined } },
    ]);
    expect(s).not.toBeNull();
    expect(s!.usd).toBeCloseTo(0.0202, 6);
    expect(s!.unpricedTokens).toBe(101_000);
  });

  it("一桶都算不出 ⇒ null（= 「这道闸不生效」），绝不返回 0 冒充实付", () => {
    expect(bucketsSpendUsd([{ usage: HEAVY_USAGE, price: { model: "神秘档-9000" } }])).toBeNull();
  });

  it("冻结回放桶（realMoney:false）⇒ 既不计价也不算「算不出」：读数是真 0 且不触发告警", () => {
    const s = bucketsSpendUsd([{ usage: HEAVY_USAGE, price: null, realMoney: false }]);
    expect(s).not.toBeNull();
    expect(s!.usd).toBe(0);
    expect(s!.unpricedTokens, "回放不是「价不可知」⇒ 不该被算进去让闸出声").toBe(0);
  });

  it("已知档位 + 零用量 = 真 0（与「不可知」分开：null 只留给算不出）", () => {
    const s = bucketsSpendUsd([{ usage: { inputTokens: 0, outputTokens: 0 }, price: STANDARD }]);
    expect(s).not.toBeNull();
    expect(s!.usd).toBe(0);
    expect(s!.unpricedTokens).toBe(0);
  });
});
