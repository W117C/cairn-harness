// 判卷 · spawn_agent 的**逐型参数面**（能力 3 工具面 × 能力 8「不骗模型」的交点）
//
// 真轨迹取证（2026-09-24，`outputs/ga-strategy-2026-09-20-rep3/supervise.events.jsonl`，
// 复跑面 = 同页 §五 的 measure-spawn-args.mts）：模型发过一次
//   { mode:"supervise", task:…, resources:["src/cart.js",…], stages:[实现→验证→修复循环] }
// 而 `spawnSupervise` 只读 `task` + `supervise` 两样 ⇒ 那份三阶段门控计划**整支静默丢弃**：
// 钱照花、worker 照派、回执里一个字没提"你的 stages 没了"。这与已修的 supervise 内层契约
// （`parseSuperviseContract` 拒未知键）是同一条线上缺一半：内层严格、外层宽松，
// 模型只要把键写在**顶层**就绕过了全部严格性。
//
// 本笔钉的不变量：**这一档不读的键，必须在派活之前点名拒绝，并说清哪一档读它。**
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { Orchestrator, type SpawnArgs } from "../src/agent/orchestrator";
import { gateToolSpecs } from "../src/agent/glm-session";
import { SPAWN_MODES } from "../src/agent/orchestrator-config";
import {
  SPAWN_ARG_KEYS, SPAWN_MODE_ARG_READS, unconsumedSpawnArgs,
} from "../src/agent/spawn-surface";

/** 规格里申报得出的那批键（模型可见面）。 */
const specKeys = (): string[] => {
  const spec = gateToolSpecs("auto").find((s) => s.function.name === "spawn_agent");
  if (!spec) throw new Error("模型面里没有 spawn_agent");
  return Object.keys((spec.function.parameters as { properties?: Record<string, unknown> }).properties ?? {});
};

describe("unconsumedSpawnArgs（纯函数：这一档到底读哪些键）", () => {
  it("supervise 带 stages + resources ⇒ 两个都算未读，并各自点名读它的那一档", () => {
    const r = unconsumedSpawnArgs("supervise", {
      mode: "supervise", task: "t", resources: ["src/a.ts"], stages: [{ role: "implement", task: "x" }],
    });
    expect(r.dropped).toEqual(["resources", "stages"]);
    expect(r.readers("stages")).toEqual(["pipeline"]);
    expect(r.readers("resources")).toContain("write");
  });

  it("read / write 只把 stages、supervise 当未读（各自那档的键一律不误伤）", () => {
    for (const mode of ["read", "write"]) {
      const r = unconsumedSpawnArgs(mode, {
        mode, task: "t", resources: ["a"], context: { constraints: ["x"] },
        model: "m", max_turns: 5, tier: "strong", role: "implement", depends_on: [],
      });
      expect(r.dropped, mode + " 的自有键被误判成未读").toEqual([]);
      expect(unconsumedSpawnArgs(mode, { mode, task: "t", stages: [{ task: "x" }] }).dropped).toEqual(["stages"]);
    }
  });

  it("pipeline 不读 role / context / model / max_turns / tier（逐环参数来自 stages 与角色，不来自顶层）", () => {
    const r = unconsumedSpawnArgs("pipeline", {
      mode: "pipeline", stages: [{ role: "review", task: "x" }],
      role: "implement", context: { constraints: ["c"] }, model: "m", max_turns: 9, tier: "strong",
    });
    expect(r.dropped).toEqual(["context", "max_turns", "model", "role", "tier"]);
    // 反向那一半：pipeline 真读的 stages / resources 不许出现在拒绝名单里
    expect(r.dropped).not.toContain("stages");
  });

  it("模型发明或笔误的顶层键（agent_type）算 unknown，并列出合法键对照", () => {
    const r = unconsumedSpawnArgs("write", { mode: "write", task: "t", agent_type: "reviewer" });
    expect(r.dropped).toEqual([]);
    expect(r.unknown).toEqual(["agent_type"]);
    for (const k of specKeys()) expect(r.legalKeys).toContain(k);
  });

  it("表里每个键至少被一档读（新增一个谁都不读的参数 ⇒ 本条立刻红）", () => {
    const readByAnyone = new Set(SPAWN_MODES.flatMap((m) => SPAWN_MODE_ARG_READS[m as never] as string[]));
    for (const k of SPAWN_ARG_KEYS) expect(readByAnyone.has(k), k + " 没有任何一档读它").toBe(true);
  });

  it("规格申报得出的键全部在表里有归属（申报得出来就必须有人读，或有档读它＝可接受）", () => {
    const tabled = new Set<string>(SPAWN_ARG_KEYS);
    for (const k of specKeys()) expect(tabled.has(k), k + " 出现在规格里却没有档位归属").toBe(true);
  });

  it("表的 mode 集与 SPAWN_MODES 逐个一致（加一档必须同时交代它读什么）", () => {
    expect(Object.keys(SPAWN_MODE_ARG_READS).sort()).toEqual([...SPAWN_MODES].sort());
  });
});

// 纯函数只证明"表算得对"；下面用真 Orchestrator 证明**拒绝发生在花钱之前**。
// 正向对照（干净调用走到审批）与反向格（申报被拒）必须同 setup：
// 只断"没有 approval_requested"在审批不落这条 emit 时是结构恒真的。
let work = "";
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "spawn-surface-"));
  await writeFile(join(work, "events.jsonl"), "", "utf8");
});
afterEach(async () => { await rm(work, { recursive: true, force: true }).catch(() => {}); });

function makeOrch(): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath: join(work, "events.jsonl"), workspace: work, parentMode: "default",
    modelFor: () => undefined, approvalTimeoutMs: 40,
    emit: async (e) => { events.push(e); },
  });
  return { orch, events };
}

describe("spawn_agent 在派活前拒掉这一档不读的键", () => {
  it("supervise + stages ⇒ 拒绝、点名 stages 与 pipeline，且零 worker 零审批（不花真钱、不打扰人）", async () => {
    const { orch, events } = makeOrch();
    const r = await orch.spawn({
      mode: "supervise", task: "修三处 bug", stages: [{ role: "implement", task: "x" }],
    } as SpawnArgs, { callId: "c1" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("stages");
    expect(r.output).toContain("pipeline");
    expect(events.filter((e) => e.type === "agent_spawned")).toEqual([]);
    expect(events.some((e) => e.type === "approval_requested"), "拒绝不该先要一张授权卡").toBe(false);
    await orch.cancelAll();
  });

  it("反向对照：干净 supervise 调用不被参数面拒，且真的走到审批（证明上一条的「零审批」是读数不是没尺）", async () => {
    const { orch, events } = makeOrch();
    const r = await orch.spawn({ mode: "supervise", task: "修三处 bug", supervise: { maxStages: 2 } } as SpawnArgs, { callId: "c2" });
    expect(r.output).toContain("未获批准");
    expect(r.output).not.toContain("不读");
    expect(events.some((e) => e.type === "approval_requested"), "本 setup 里审批必须落 emit，否则上一条是假锚点").toBe(true);
    await orch.cancelAll();
  });

  it("pipeline 带 stages + resources ⇒ 不被参数面拒（resources 是它读的那一档）", async () => {
    const { orch } = makeOrch();
    const r = await orch.spawn({
      mode: "pipeline", task: "", resources: ["src/a.ts"], stages: [{ role: "implement", task: "x" }],
    } as SpawnArgs, { callId: "c3" });
    expect(r.output).not.toContain("不读");
    expect(r.output).toContain("未获批准");
    await orch.cancelAll();
  });

  it("未知顶层键同样在派活前拒（agent_type 这类笔误不许静默按默认面跑）", async () => {
    const { orch, events } = makeOrch();
    const r = await orch.spawn({ mode: "read", task: "调研 X", agent_type: "reviewer" } as SpawnArgs, { callId: "c4" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("agent_type");
    expect(events.filter((e) => e.type === "agent_spawned")).toEqual([]);
    await orch.cancelAll();
  });

  it("崩溃恢复的重派路径不受影响（RespawnArgs 是 read/write 的自有键集）", async () => {
    const { orch } = makeOrch();
    const r = await orch.respawn({ mode: "write", task: "改 X", resources: ["src/a.ts"], role: "implement" }, { callId: "c5" });
    expect(r.output).not.toContain("不读");
    expect(r.output).not.toContain("agent_type");
    await orch.cancelAll();
  });
});
