// goal 美元闸的「生产输入」那一跳：settings 存的是 provider 模型名（glm-5.2），价表的键是档位 id
// （glm-standard），中间的反查只许有一处（orchestrator-join 的 priceForModel）。
// 为什么值得单独钉：这一跳坏了**没人会看见**——续跑判据的单测全部直接注入 spentUsd，而 2026-09-20
// 实测：把模型名直接当价表键传，对产品里可选的 12 个模型名 12 次全算不出钱 ⇒ 美元闸恒惰、
// 一路按轮次闸烧到上限，而 tsc / vitest / 变异表全绿。「能力已发货、产品路径绕过它」的又一例。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { priceForModel, spentUsdFor } from "../src/agent/orchestrator-join";
import { goalReminder, goalStopDecision, goalWindowSpend } from "../src/agent/goal";
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";
import type { AgentEvent } from "../src/events";

const USAGE = { inputTokens: 200_000, outputTokens: 20_000 };

function walkSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkSources(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("priceForModel：两态输入都要能落到价表", () => {
  it("用户在设置里选的那个名字（provider 模型名）逐档都算得出钱", () => {
    for (const spec of DEFAULT_MODEL_TABLE) {
      const spend = spentUsdFor(priceForModel(spec.model), USAGE);
      expect(spend === null, spec.model + " 算不出钱（闸会静默惰掉）").toBe(false);
      expect(spend?.usd).toBeGreaterThan(0);
    }
  });

  it("档位 id 也认（路由表与调试路径传的就是 id，两态调用方都真实存在）", () => {
    expect(spentUsdFor(priceForModel("glm-standard"), USAGE)?.usd).toBeGreaterThan(0);
  });

  it("认不出的名字 ⇒ 不产值表键 ⇒ null，绝不折成 $0（不可知不是免费）", () => {
    const price = priceForModel("some-local-llm-not-in-table");
    expect(price.priceId).toBeUndefined();
    expect(spentUsdFor(price, USAGE)).toBeNull();
  });

  it("真拨模型名优先于路由档位（按实际服务的模型计价，不按选择依据）", () => {
    expect(priceForModel("glm-5.2", "glm-strong").priceId).toBe("glm-standard");
  });

  it("闸在真模型名下真的会拦：$0.05 上限 × 200k/20k 用量 ⇒ stop（不是惰过去）", () => {
    const spend = spentUsdFor(priceForModel("glm-5.2"), USAGE);
    const d = goalStopDecision({
      turn: 1,
      spec: { objective: "把失败测试修到绿", maxTurns: 8, maxUsd: 0.05 },
      spentUsd: spend === null ? null : spend.usd,
      evidence: "absent",
      wrote: true,
      truncated: false,
    });
    expect(d.kind).toBe("stop");
  });
});

describe("价表键只在 priceForModel 一处成形", () => {
  it("src 里除 orchestrator-join 外不许再**造**这个字段（对象字面量形态；读它不等于造它）", () => {
    // 判的是「第二份手搓价表键的写法」——`.priceId` 的**读取**是合法的（spentUsdFor / priceTagText 就要读它），
    // 所以扫 `priceId:`（键）而不是 `priceId`（任何出现）。上一版扫后者，被自己新写的读取判红过一次：
    // 严到伤合法用法的面，下一步就是被人当噪声门关掉。
    const offenders = walkSources(join(__dirname, "..", "src"))
      .filter((f) => !f.endsWith(join("agent", "orchestrator-join.ts")))
      .filter((f) => readFileSync(f, "utf8").includes("priceId:"))
      .map((f) => f.slice(f.indexOf("src")));
    expect(offenders).toEqual([]);
  });
});

/* 目标窗口的花费读数：主会话那一段按会话档折，worker 那一段**只用它终态回执里已入账的表价**。
 *  为什么不再"全部 token × 会话档"：worker 可以跑在别的档上（价表跨度 40 倍），一乘就和同一屏的
 *  worker 回执分叉——而那个回执正是用户判断"这活贵不贵"的地方（2026-09-23 实测，见能力 39）。
 *  spent_usd 的**产出**由 tests/worker-spent-usd.test.ts（14 条）与 `spent-usd-*` 锚点看着；
 *  这一格只管窗口怎么把两半拼起来。 */
describe("goalWindowSpend（主会话一档 + worker 已入账表价）", () => {
  const mainUse = (i: number, o: number): AgentEvent => ({ type: "usage", inputTokens: i, outputTokens: o } as AgentEvent);
  const workerUse = (id: string, i: number, o: number): AgentEvent =>
    ({ type: "usage", agent_id: id, inputTokens: i, outputTokens: o } as AgentEvent);
  const spawned = (id: string, model?: string): AgentEvent =>
    ({
      type: "agent_spawned", agent_id: id, parent_event_id: 1, mode: "read", task: "t",
      max_turns: 4, permission_mode: "default", ...(model === undefined ? {} : { model }), ts: 1,
    } as AgentEvent);
  const done = (id: string, spentUsd?: number): AgentEvent =>
    ({
      type: "agent_result", agent_id: id, status: "done", summary: "s",
      usage: { inputTokens: 0, outputTokens: 0 }, tool_stats: {},
      artifacts: spentUsd === undefined ? {} : { spent_usd: spentUsd },
    } as AgentEvent);

  // 100k in + 1k out 在当前价表：flash $0.0202 / standard $0.2020 / strong $0.8080
  const FLASH_WORKER = [spawned("w1", "glm-5.3-flash"), workerUse("w1", 100_000, 1_000), done("w1", 0.0202)];

  it("反向那一格：会话档很贵而 worker 跑便宜档 ⇒ 闸只看回执里那 $0.0202，不乘成 $0.808", () => {
    const r = goalWindowSpend(FLASH_WORKER, "glm-5.2-pro");
    expect(r.spentUsd).not.toBeNull();
    expect(r.spentUsd).toBeCloseTo(0.0202, 6);
    expect(r.spentUsd).not.toBeCloseTo(0.808, 6); // 旧算法（全部 token × 会话档）会读成这个
    expect(r.unbookedWorkers).toBe(0);
  });

  it("正向那一格：worker 跑贵档并已入账 ⇒ 闸按入账的钱停，不按会话的便宜档低估", () => {
    const r = goalWindowSpend(
      [spawned("w1", "glm-strong"), workerUse("w1", 100_000, 1_000), done("w1", 0.808)],
      "glm-5.3-flash",
    );
    expect(r.spentUsd).toBeCloseTo(0.808, 6);
    expect(r.spentUsd).not.toBeCloseTo(0.0202, 6); // 旧算法把强档的 token 读成 flash 的钱
  });

  it("主会话那一段仍按会话档折（与 #54 那条端到端同一把尺，两半相加不互相顶包）", () => {
    const r = goalWindowSpend([mainUse(100_000, 1_000), ...FLASH_WORKER], "glm-5.2");
    expect(r.spentUsd).toBeCloseTo(0.202 + 0.0202, 6);
  });

  it("在途 worker（还没终态回执）⇒ 本拍不入账，但 unbookedWorkers 报出来，好让提醒块说「可能晚一步」", () => {
    const r = goalWindowSpend([spawned("w1", "glm-strong"), workerUse("w1", 100_000, 1_000)], "glm-5.3-flash");
    expect(r.spentUsd).toBe(0);
    expect(r.unbookedWorkers).toBe(1);
  });

  it("终态了却没有 spent_usd（回放或未注册档位）⇒ 不再当作在途，也绝不当成会话档的花费", () => {
    const r = goalWindowSpend([spawned("w1"), workerUse("w1", 100_000, 1_000), done("w1")], "glm-5.2");
    expect(r.unbookedWorkers).toBe(0);
    expect(r.spentUsd).toBe(0);
  });

  it("算不出钱时保持原语义：主会话价不可知且没有入账 ⇒ null；只要有一笔入账就不 null", () => {
    expect(goalWindowSpend([mainUse(100_000, 1_000)], "some-local-llm-not-in-table").spentUsd).toBeNull();
    const mixed = goalWindowSpend([...FLASH_WORKER, mainUse(100_000, 1_000)], "some-local-llm-not-in-table");
    expect(mixed.spentUsd).toBeCloseTo(0.0202, 6); // 知道的那一半照算（未知那半不当免费，也不当 0）
  });

  // 滞后必须**说出口**：否则下一轮数字突然跳升，模型和人都会把"本拍没算 worker"读成"上一轮没花钱"。
  it("在途 worker 的那一段写进提醒块；没有在途时逐字不提（每轮重送，少一行是一行的 token）", () => {
    const spec = { objective: "把测试修绿", maxTurns: 8, maxUsd: 1 };
    const withLag = goalReminder(spec, 2, 0, "absent", undefined, 2);
    expect(withLag).toContain("另有 2 个 worker 的花费要等终态回执才入账");
    expect(goalReminder(spec, 2, 0, "absent")).not.toContain("终态回执才入账");
  });
});
