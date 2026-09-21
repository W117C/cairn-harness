// goal 美元闸的「生产输入」那一跳：settings 存的是 provider 模型名（glm-5.2），价表的键是档位 id
// （glm-standard），中间的反查只许有一处（orchestrator-join 的 priceForModel）。
// 为什么值得单独钉：这一跳坏了**没人会看见**——续跑判据的单测全部直接注入 spentUsd，而 2026-09-20
// 实测：把模型名直接当价表键传，对产品里可选的 12 个模型名 12 次全算不出钱 ⇒ 美元闸恒惰、
// 一路按轮次闸烧到上限，而 tsc / vitest / 变异表全绿。「能力已发货、产品路径绕过它」的又一例。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { priceForModel, spentUsdFor } from "../src/agent/orchestrator-join";
import { goalStopDecision } from "../src/agent/goal";
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";

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

  it("已定的档位优先于按名反查（路由决策不能被模型名盖掉）", () => {
    expect(priceForModel("glm-5.2", "glm-strong").priceId).toBe("glm-strong");
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
    // 判的是「第二份手搓价表键的写法」——`.priceId` 的**读取**是合法的（budgetRateKnown 就要读它），
    // 所以扫 `priceId:`（键）而不是 `priceId`（任何出现）。上一版扫后者，被自己新写的读取判红过一次：
    // 严到伤合法用法的面，下一步就是被人当噪声门关掉。
    const offenders = walkSources(join(__dirname, "..", "src"))
      .filter((f) => !f.endsWith(join("agent", "orchestrator-join.ts")))
      .filter((f) => readFileSync(f, "utf8").includes("priceId:"))
      .map((f) => f.slice(f.indexOf("src")));
    expect(offenders).toEqual([]);
  });
});
