// 美元闸的价键：闸「估多少钱」必须跟着这一跳**真拨的那一档**，不是设置盘上那个字段。
//
// 为什么单独立一面（2026-09-27 实测，outputs/cost-price-key-2026-09-27/probe-price-key.mts）：
// 会话成本闸与 goal 美元闸都读 `store().get().model`，而拨号读 `resolveMainModel(...)` 的 resolved spec。
// `settings.model` 出厂留空是**文档化缺省**（「留空 = 由 provider 层取缺省」），per-run 又能指定别的档位，
// 于是三种合法配置下闸与实付分叉：
//  ①留空 ⇒ 闸算不出价（整闸惰掉，用户买的这份保险没生效）；
//  ②指定强档 ⇒ 闸只读到实付的 0.25 倍（上限 $1 要实际花到 $4 才拦）；
//  ③指定便宜档 ⇒ 读到 10 倍（任务被假「预算耗尽」掐掉）。
// 这和 2026-09-23 修掉的 worker 那一支是同一族（那时全部 token 乘会话档 ⇒ 比实付低 40 倍）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { budgetPriceKeyOf, resolveRunModel } from "../src/main/agent-runner";
import { priceForModel, spentUsdFor } from "../src/agent/orchestrator-join";

const USAGE = { inputTokens: 100_000, outputTokens: 10_000 };
/** 真拨那一档折出来的钱（对照基准）。 */
const usdOf = (name: string): number | null => spentUsdFor(priceForModel(name), USAGE)?.usd ?? null;

const envBackup = { M0A_PROVIDER: process.env.M0A_PROVIDER, CAIRN_MODEL: process.env.CAIRN_MODEL };
afterEach(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("budgetPriceKeyOf / resolveRunModel：闸的价键取自真拨的那一档", () => {
  it("② per-run 指定强档：闸折钱的档 = 拨号的档（旧写法只读到实付的 1/4）", () => {
    const sel = resolveRunModel({ provider: "glm", model: "glm-5.2" }, "glm-strong");
    const dialed = sel.kind === "demo" ? "" : sel.spec.model;
    expect(budgetPriceKeyOf(sel)).toBe(dialed);
    expect(usdOf(budgetPriceKeyOf(sel))).toBe(usdOf(dialed));
    // 牙齿：设置盘那个字段（旧写法用的键）必须**不是**同一个数，否则这条判据零分辨力。
    expect(usdOf("glm-5.2")).not.toBe(usdOf(dialed));
  });

  it("③ per-run 指定便宜档：闸不再读到 10 倍（假「预算耗尽」会掐掉还在预算内的任务）", () => {
    const sel = resolveRunModel({ provider: "glm", model: "glm-5.2" }, "glm-flash");
    const dialed = sel.kind === "demo" ? "" : sel.spec.model;
    expect(usdOf(budgetPriceKeyOf(sel))).toBe(usdOf(dialed));
    expect(usdOf("glm-5.2")).not.toBe(usdOf(dialed));
  });

  it("① 出厂缺省（model 留空）：闸跟着 provider 层缺省那一档，不再算不出价", () => {
    const sel = resolveRunModel({ provider: "glm", model: "" });
    expect(budgetPriceKeyOf(sel)).toBe("glm-5.2");
    expect(usdOf(budgetPriceKeyOf(sel))).toBeGreaterThan(0);
    // 反向：留空这个字符串当键 ⇒ 价不可知（这就是修之前那条闸的真实下场）。
    expect(usdOf("")).toBeNull();
  });

  it("demo 通道不拨号不付钱 ⇒ 价键空串（不可知由闸出声，绝不折成 $0）", () => {
    const sel = resolveRunModel({ provider: "demo", model: "" });
    expect(sel.kind).toBe("demo");
    expect(budgetPriceKeyOf(sel)).toBe("");
    expect(usdOf(budgetPriceKeyOf(sel))).toBeNull();
  });

  it("env 覆盖 provider 时闸跟着覆盖后的那一档（同一次解析，不留第二把尺）", () => {
    process.env.M0A_PROVIDER = "openai";
    const sel = resolveRunModel({ provider: "glm", model: "" }); // 设置盘仍是 glm
    expect(sel.kind).toBe("openai");
    expect(budgetPriceKeyOf(sel)).toBe(sel.kind === "demo" ? "" : sel.spec.model);
    expect(budgetPriceKeyOf(sel)).not.toBe("glm-5.2");
  });
});

describe("接线：两道闸共用同一份派生，且不许再抄第三份解析", () => {
  const src = () => readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");

  it("env + 设置盘的解析式子在本文件里只许出现一次（三次副本就是本次缺陷的成因）", () => {
    const t = src();
    expect([...t.matchAll(/resolveMainModel\(/g)].length).toBe(1);
    // 两处消费（会话成本闸 + goal 美元闸）都得走派生函数；少一处 = 那一支回到读盘上字段。
    expect([...t.matchAll(/budgetPriceKeyOf\(/g)].length).toBeGreaterThanOrEqual(3);
  });

  it("两处消费各自接线在位（两个函数都未导出 ⇒ 只能钉形状），且旧写法不许复活", () => {
    const t = src();
    expect(t, "会话成本闸丢了派生 ⇒ 最常见配置下闸惰").toMatch(
      /priceModel: budgetPriceKeyOf\(runModel \?\? resolveRunModel\(s\)\)/);
    expect(t, "goal 美元闸丢了派生 ⇒ per-run 指定档位时它按会话档折").toMatch(
      /const model = budgetPriceKeyOf\(args\.runModel\);/);
    expect(t, "run 的解析没递进 goalNextTurn ⇒ 那一支永远只能读设置盘").toMatch(
      /goalNextTurn\(\{[^}]*runModel: modelSelection/);
    // 放宽成 `[^)]*`：2026-10-05 S3 信任闸给这一处加了第三个实参（trustedRepo），
    // 原写法把把**整个实参表**钉死，于是加一个与本断言无关的参数就红。
    // 原意是「runModel 这一档必须递进编排器」⇒ 前两个实参仍逐字钉住，尾部允许追加。
    expect(t, "run 的解析没递进编排器 ⇒ 同上").toMatch(/orchestratorExtras\(a\.sandbox, a\.runModel[^)]*\)/);
    expect(t, "逐请求指定的模型没进 buildSessionOrchestrator ⇒ 会话闸看不到本 run 真拨的档").toMatch(
      /\.\.\.\(opts\.modelSelection \? \{ runModel: opts\.modelSelection \} : \{\}\)/);
    // 反向：把闸的键退回设置盘字段（旧写法）必须当场红，而不是靠人记得。
    expect(t).not.toMatch(/priceModel: s\.model/);
    expect(t).not.toMatch(/const model = \(await store\(\)\.get\(\)\)\.model/);
  });
});
