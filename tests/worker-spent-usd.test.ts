// W3②「价格标签」验收（spec §5 + §11 item 7 的未做项②）：worker 的钱此前只喂 bandit
// （costUsd 在 rewardBandit 里算完即丢），派工时模型看不到单价、收队时看不到花了多少、
// 终态结果里也没有机器可读的花费 ⇒ G-A 的 $/成功任务 没有数据源，「最省钱」无从判分。
// 本测钉住三件事：① 价格只有一个事实源（routing/pricing 的档位表 + 表价）；
// ② 价格不可知时报「未知」而不是 $0（把不可知记成免费是本仓点名的假绿形状）；
// ③ 冻结剧本（scriptedWorkerModel）不产生钱——demo/checks 路径不得冒充实付。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel } from "../src/agent/orchestrator";
import { joinPriceNote, priceTagText, shapeJoinRows, spentUsdFor, type JoinInput, type JoinRow, type WorkerSpend } from "../src/agent/orchestrator-join";
import { DEFAULT_MODEL_TABLE, findSpecByNameOrId } from "../src/providers/registry";
import { glmDefaultModelName, streamGlm } from "../src/providers/glm";
import { costUsd, priceOf } from "../src/routing/pricing";
import type { ModelOutput } from "../src/providers";
import type { WorkerModel } from "../src/agent/worker-model";

let work: string;
let logPath: string;
const savedModelEnv = process.env.M0_MODEL;
const savedKeyEnv = process.env.M0_API_KEY;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "w3-spent-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  if (savedModelEnv === undefined) delete process.env.M0_MODEL;
  else process.env.M0_MODEL = savedModelEnv;
  if (savedKeyEnv === undefined) delete process.env.M0_API_KEY;
  else process.env.M0_API_KEY = savedKeyEnv;
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

async function waitFor(pred: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

function makeOrch(model: WorkerModel | undefined): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: work,
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    ...(model ? { modelFor: (): WorkerModel => model } : {}),
  });
  return { orch, events };
}

const USAGE: ModelOutput = { type: "usage", inputTokens: 1000, outputTokens: 500 };
const DONE_SCRIPT: ModelOutput[] = [USAGE, { type: "assistant_message", content: "## 结论\n- 完成了。" }];

/** 与 scriptedWorkerModel 同形但**不打 scripted 标**：代表真实 provider（会付钱那条）。 */
function realishModel(script: ModelOutput[]): WorkerModel {
  let cursor = 0;
  return async function* () {
    while (cursor < script.length) yield script[cursor++] as ModelOutput;
  };
}

const resultOf = (events: AgentEvent[]) =>
  events.find((e): e is Extract<AgentEvent, { type: "agent_result" }> => e.type === "agent_result");

describe("W3② 价格档位的反查（单一事实源 = 档位表）", () => {
  it("按真实模型名反查档位 id：复用 findSpecByNameOrId（不另开第二份反查表），查不到给 undefined", () => {
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, "glm-5.2")?.id).toBe("glm-standard");
    expect(findSpecByNameOrId(DEFAULT_MODEL_TABLE, "不存在-的-模型")).toBeUndefined();
    // 价格表键必须就是档位表 id（价格标签与路由共用同一张表的同一批键，否则 costUsd 会抛）
    for (const spec of DEFAULT_MODEL_TABLE) expect(priceOf(spec.id).inputPerMTok).toBeGreaterThan(0);
  });

  it("glmDefaultModelName 与 streamGlm 真实拨号用的模型名逐字相等（防第四份 env 副本漂移）", async () => {
    process.env.M0_MODEL = "sentinel-model-xyz";
    process.env.M0_API_KEY = "test-key-not-dialing"; // 只过 key 存在性闸；fetchImpl 已注入，不外拨
    expect(glmDefaultModelName()).toBe("sentinel-model-xyz");
    let sent = "";
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sent = String(JSON.parse(String(init?.body ?? "{}")).model ?? "");
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    for await (const _ of streamGlm([{ role: "user", content: "hi" }], { fetchImpl })) {
      // 只为触发一次拨号体：内容不重要
    }
    expect(sent).toBe(glmDefaultModelName());
  });
});

describe("W3② 花费折算（priceOf/costUsd 是唯一价源）", () => {
  it("已知档位：花费 = costUsd 同值，且如实带上标定态", () => {
    const usage = { inputTokens: 1000, outputTokens: 500 };
    const got = spentUsdFor({ model: "glm-5.2", priceId: "glm-standard" }, usage);
    expect(got).not.toBeNull();
    expect(got!.usd).toBeCloseTo(costUsd("glm-standard", usage), 10);
    expect(got!.usd).toBeGreaterThan(0);
    expect(got!.calibrated).toBe(priceOf("glm-standard").calibrated === true);
  });

  it("价格不可知（无档位 / 无 priceId）→ null，绝不返回 0", () => {
    const usage = { inputTokens: 1000, outputTokens: 500 };
    expect(spentUsdFor(null, usage)).toBeNull();
    expect(spentUsdFor({ model: "scripted" }, usage)).toBeNull();
  });

  it("零用量 + 已知档位 = 真 0（与「不可知」区分开）", () => {
    const got = spentUsdFor({ model: "glm-5.2", priceId: "glm-standard" }, { inputTokens: 0, outputTokens: 0 });
    expect(got).not.toBeNull();
    expect(got!.usd).toBe(0);
  });

  it("回执一行：带模型名 + 单价 + 标定态；不可知时出现「价格未知」且没有 $0", () => {
    const priced = priceTagText({ model: "glm-5.2", priceId: "glm-standard" }, 0.0123);
    expect(priced).toContain("glm-5.2");
    expect(priced).toContain("2");
    expect(priced).toContain("未标定");
    expect(priced).toContain("0.0123");
    const unknown = priceTagText(null, null);
    expect(unknown).toContain("价格未知");
    expect(unknown).not.toContain("$0");
  });
});

describe("W3② 三个面真的接上（spawn 回执 / agent_result / wait 行）", () => {
  it("冻结剧本 worker：回执写价格未知，终态与收队行都不带 spent_usd", async () => {
    const { orch, events } = makeOrch(scriptedWorkerModel(DONE_SCRIPT));
    const r = await orch.spawn({ mode: "read", task: "调研" }, { callId: "s1" });
    expect(r.ok).toBe(true);
    const receipt = JSON.parse(r.output) as { price?: string };
    expect(String(receipt.price)).toContain("价格未知");
    expect(r.output).not.toContain("spent_usd");
    expect(await waitFor(() => resultOf(events) !== undefined)).toBe(true);
    await orch.waitAll(5_000);
    const artifacts = resultOf(events)!.artifacts as Record<string, unknown>;
    expect(artifacts.spent_usd).toBeUndefined();
    const body = await orch.waitForAgents([], 1_000);
    expect(body.rows[0]).not.toHaveProperty("spent_usd");
  }, 15_000);

  it("真实 provider 路径：回执带单价、终态带 spent_usd 与标定态、收队行带同一笔钱", async () => {
    process.env.M0_MODEL = "glm-5.2";
    const { orch, events } = makeOrch(realishModel(DONE_SCRIPT));
    const r = await orch.spawn({ mode: "read", task: "调研" }, { callId: "s1" });
    const receipt = JSON.parse(r.output) as { price?: string };
    expect(String(receipt.price)).toContain("glm-5.2");
    expect(await waitFor(() => resultOf(events) !== undefined)).toBe(true);
    await orch.waitAll(5_000);

    const artifacts = resultOf(events)!.artifacts as { spent_usd?: number; price_calibrated?: boolean };
    const expected = costUsd("glm-standard", { inputTokens: 1000, outputTokens: 500 });
    expect(artifacts.spent_usd, "终态必须带机器可读花费").toBeCloseTo(expected, 10);
    expect(artifacts.price_calibrated).toBe(false);

    const body = await orch.waitForAgents([], 1_000);
    const row = body.rows[0] as JoinRow & { spent_usd?: number };
    expect(row.spent_usd).toBeCloseTo(expected, 10);
  }, 15_000);
});

describe("W3② 整批合计的可读账", () => {
  const spend = (usd: number): WorkerSpend => ({ usd, calibrated: true });

  it("合计只加已知的，未计数量如实报出", () => {
    const note = joinPriceNote([spend(0.002), spend(0.004), null]);
    expect(note).toContain("0.006");
    expect(note).toContain("1 个 worker 价格未知");
  });

  it("全是未知 ⇒ 不谎报合计（返回 null，让整批帽少付一行）", () => {
    expect(joinPriceNote([null, null])).toBeNull();
    expect(joinPriceNote([])).toBeNull();
  });

  it("含未标定档 ⇒ 合计旁边写明「不可当省钱证据」", () => {
    const note = joinPriceNote([spend(0.002), { usd: 0.004, calibrated: false }]);
    expect(note).toContain("未标定");
  });

  it("shapeJoinRows 把 spent 逐行带到 rows（被整批帽摘掉摘要也不摘花费）", () => {
    // 每行摘要都吃满逐行帽（1600 ASCII ≈ 400 token）⇒ 第 7 行被整批帽（2400）摘掉摘要
    const row = (i: number): JoinInput => ({
      agentId: "a" + String(i),
      status: "done",
      task: "t",
      report: "x".repeat(1600),
      usage: { inputTokens: 10, outputTokens: 5 },
      spent: spend(0.001 * i),
    });
    const shaped = shapeJoinRows([1, 2, 3, 4, 5, 6, 7].map(row));
    const byId = new Map(shaped.rows.map((r) => [r.agent_id, r]));
    expect(shaped.degraded).toEqual(["a7"]);
    expect(byId.get("a1")!.spent_usd).toBe(0.001);
    const dropped = byId.get("a7")!;
    expect(dropped.summary, "整批帽摘掉的是散文").toBe("");
    expect(dropped.spent_usd, "被帽省略摘要的行仍要带花费").toBe(0.007);
  });
});
