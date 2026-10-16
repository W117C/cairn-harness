// 判卷 · supervise 受限循环的契约面：模型申报得出来、解析得住、越界就出声。
//
// 实测缺口（2026-09-24，按用户改的方向「agent 自己安排」重扫编排面）：
// 执行端一直读 `args.supervise.{maxStages, forbidden}`（orchestrator 里 fail-visible 校验），
// 但 spawn_agent 的**规格里根本没有 supervise 这一支** ⇒ 模型只能猜嵌套形状；而
// `scripts/ga-strategy.ts` 的策略文案还在教它"用 maxStages=3"——教了一个规格上不存在的参数。
// 顺带把这条线上本来就该严的两处一起收紧：
//  · 未知键（含笔误 `forbiden`）不再静默被吃：申报了却不生效 = 模型以为禁了某面，实际没禁；
//  · `budget` 归人（会话成本闸），模型申报它 = 拒并说清归谁 —— 与 refine_goal 同一个原则。
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Orchestrator, type SpawnArgs } from "../src/agent/orchestrator";
import {
  SUPERVISE_MAX_STAGES_DEFAULT, SUPERVISE_MAX_STAGES_MAX, SUPERVISE_MAX_STAGES_MIN,
  SUPERVISE_MODEL_FIELDS, parseSuperviseContract,
} from "../src/agent/supervise-contract";
import { gateToolSpecs } from "../src/agent/session-provider";

const fieldNames = SUPERVISE_MODEL_FIELDS.map((f) => f.name);

describe("parseSuperviseContract", () => {
  it("不申报 ⇒ 缺省契约（默认环数 + 无禁改面），不是错误", () => {
    for (const raw of [undefined, null, {}]) {
      const r = parseSuperviseContract(raw);
      expect(r.error, JSON.stringify(raw)).toBeNull();
      expect(r.contract).toEqual({ maxStages: SUPERVISE_MAX_STAGES_DEFAULT, forbidden: [] });
    }
  });

  it("环数越界 / 非整数 ⇒ 拒并把合法区间写进话里（不静默钳制，也不静默回落缺省）", () => {
    for (const bad of [0, SUPERVISE_MAX_STAGES_MAX + 1, 2.5, "6"]) {
      const r = parseSuperviseContract({ maxStages: bad });
      expect(r.contract, String(bad)).toBeNull();
      expect(r.error).toContain(String(SUPERVISE_MAX_STAGES_MIN));
      expect(r.error).toContain(String(SUPERVISE_MAX_STAGES_MAX));
    }
  });

  it("合法键集内都能过（反控：不许把「什么都拒」当严格）", () => {
    const r = parseSuperviseContract({ maxStages: 3, forbidden: ["src/generated/**"] });
    expect(r.error).toBeNull();
    expect(r.contract).toEqual({ maxStages: 3, forbidden: ["src/generated/**"] });
  });

  it("笔误键必须点名并列出资格上的合法键 —— 静默吃掉 = 申报了却没生效", () => {
    const r = parseSuperviseContract({ maxStages: 3, forbiden: ["a"] });
    expect(r.contract).toBeNull();
    expect(r.error).toContain("forbiden");
    for (const k of fieldNames) expect(r.error, "提示要给出对照的合法键 " + k).toContain(k);
  });

  // 第 320 页：这一格单独钉「理由」那一半。上面那条判的是"拒了、点名了、给了合法清单"，
  // 而「拼错的键不会生效，故直接拒」是模型唯一能据此改下次申报的依据——删掉这句话，前面三件事一件都不变。
  it("拒因里那句「拼错的键不会生效」跟着拒一起走：删掉它行为一件不变、模型少知道一件事", () => {
    const r = parseSuperviseContract({ forbiden: ["a"] });
    expect(r.contract).toBeNull();
    expect(r.error, "这一句是申报面与生效面之间唯一的说明").toContain("拼错的键不会生效，故直接拒");
  });

  it("申报 budget ⇒ 拒，并说清这条闸归人（模型不能给自己开预算）", () => {
    const r = parseSuperviseContract({ budget: 99 });
    expect(r.contract).toBeNull();
    expect(r.error).toContain("budget");
    expect(r.error).toContain("归人");
  });

  it("forbidden 不是字符串数组 ⇒ 拒（旧口径 parseStringList 会把混进来的数字静默丢掉）", () => {
    expect(parseSuperviseContract({ forbidden: "src/a.ts" }).contract).toBeNull();
    const mixed = parseSuperviseContract({ forbidden: ["ok", 7] });
    expect(mixed.error).toContain("forbidden");
    expect(mixed.contract).toBeNull();
  });
});

describe("规格面与解析面同源", () => {
  it("spawn_agent 规格里有 supervise，且申报字段集与解析器读的完全一致", () => {
    const spec = gateToolSpecs("auto").find((s) => s.function.name === "spawn_agent");
    const props = (spec!.function.parameters as { properties?: Record<string, never> }).properties!;
    const sup = props.supervise as { type: string; properties?: Record<string, { description?: string }> };
    expect(sup, "规格里没有 supervise 这一支 ⇒ 模型只能猜嵌套，而策略文案已经在教它写 maxStages").toBeTruthy();
    expect(sup.type).toBe("object");
    expect(Object.keys(sup.properties!).sort()).toEqual([...fieldNames].sort());
    // 每个申报字段都得有描述：光给名字等于让模型猜语义
    for (const [k, v] of Object.entries(sup.properties!)) expect(v.description, k + " 缺描述").toBeTruthy();
  });

  it("budget 不在规格里（钱闸不是模型能申报的东西）", () => {
    expect(fieldNames).not.toContain("budget");
    const spec = gateToolSpecs("auto").find((s) => s.function.name === "spawn_agent");
    const sup = ((spec!.function.parameters as { properties: Record<string, never> }).properties.supervise as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(sup)).not.toContain("budget");
  });
});

// 只测纯函数会留一格空白：编排器**真不真用**这份解析器。两条对照放这里——
// 笔误键必须在**审批之前**就被拒（否则模型会先吃到一张授权卡，再发现约束没生效）。
describe("spawn_agent(supervise) 真走这份契约解析", () => {
  async function spawnSupervise(supervise: Record<string, unknown>): Promise<string> {
    const work = await mkdtemp(join(tmpdir(), "sup-contract-"));
    const logPath = join(work, "events.jsonl");
    await writeFile(logPath, "", "utf8");
    const orch = new Orchestrator({
      logPath, workspace: work, parentMode: "default",
      modelFor: () => undefined, emit: async () => {},
      approvalTimeoutMs: 40, // 没有审批通道：让它 fail-closed 地快到期，而不是挂 120s
    });
    const r = await orch.spawn({ mode: "supervise", task: "把 X 改成 Y", supervise } as SpawnArgs, { callId: "s1" });
    await orch.cancelAll();
    return r.output;
  }

  it("笔误键 forbiden：拒因点名这个键，且没走到审批（不是一张卡后再静默失效）", async () => {
    const out = await spawnSupervise({ forbiden: ["a"] });
    expect(out).toContain("forbiden");
    expect(out).not.toContain("未获批准");
  });

  it("合法契约：过解析、走到审批面（缺审批通道即 fail-closed 拒）", async () => {
    const out = await spawnSupervise({ maxStages: 2, forbidden: ["a"] });
    expect(out).toContain("未获批准");
    expect(out).not.toContain("forbiden");
  });
});
