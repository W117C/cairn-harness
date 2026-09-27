// 读数探针：两道美元闸的**价键**从哪来，与实际拨号的模型差多少。
// 只读，不改任何东西。跑法：node --import tsx outputs/cost-price-key-2026-09-27/probe-price-key.mts
import { resolveMainModel } from "../../src/main/provider-runtime";
import { priceForModel, bucketsSpendUsd } from "../../src/agent/orchestrator-join";
import { DEFAULT_MODEL_TABLE } from "../../src/providers/registry";

/** 一条真实用量（10k in + 1k out）。 */
const USAGE = { inputTokens: 100_000, outputTokens: 10_000 };

function priceKeyProbe(label: string, settingsModel: string, requestModel?: string) {
  const selection = resolveMainModel({
    forcedKind: undefined,
    configuredKind: "glm",
    settingsModel,
    requestModel,
    legacyEnvModel: undefined,
  });
  const dialed = selection.kind === "demo" ? "(demo)" : selection.spec.model;
  const gateKey = settingsModel;               // 今天两道闸读的键（agent-runner:246 / :1787）
  const spend = bucketsSpendUsd([{ usage: USAGE, price: priceForModel(gateKey) }]);
  const truth = bucketsSpendUsd([{ usage: USAGE, price: priceForModel(dialed) }]);
  console.log(
    `${label}\n  实际拨号 = ${dialed}（modelExplicit=${String(selection.kind !== "demo" && selection.modelExplicit)}）` +
    `\n  闸用价键 = ${JSON.stringify(gateKey)} ⇒ 闸读到的 $ = ${spend === null ? "null（闸惰）" : String(spend.usd)}` +
    ` · 真按拨号档 = ${truth === null ? "null" : String(truth.usd)}` +
    `${spend !== null && truth !== null && truth.usd > 0 ? ` ⇒ 闸 = 实付的 ${(spend.usd / truth.usd).toFixed(2)} 倍` : ""}`,
  );
}

console.log(`档位表 glm 三档：${DEFAULT_MODEL_TABLE.filter((s) => s.provider === "glm").map((s) => `${s.id}=${s.model}`).join(", ")}`);
priceKeyProbe("① 出厂配置（provider=glm，model 留空 = 文档说的「由 provider 层取缺省」）", "");
priceKeyProbe("② per-run 指定强档（RunRequest.model=glm-strong），settings 仍写 glm-5.2", "glm-5.2", "glm-strong");
priceKeyProbe("③ per-run 指定便宜档（RunRequest.model=glm-flash），settings 写 glm-5.2", "glm-5.2", "glm-flash");
priceKeyProbe("④ 一致配置（对照：闸与拨号同档）", "glm-5.2");
