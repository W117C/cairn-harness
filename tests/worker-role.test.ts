// 判卷 · 模型侧点名的 worker 角色（能力 4 长程规划 / 能力 7 最小权限的交点）
//
// 两条一直存在的形状，这一笔同时闭上：
//  ① 角色只活在内存里的 `handle.agentType` —— `agent_spawned` 事件不带它 ⇒ 崩溃恢复从事件流重建时角色丢了，
//     审计面也永远读不到"这个 worker 当时按哪张角色面跑"；
//  ② 角色只能由 sequencer 逐环注入（pipeline 一条路）⇒ 「用户自定义子智能体」对 read/write/supervise 无效，
//     模型手里有注册好的角色却调不动。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent, type AgentSpawnedEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";
import { respawnArgsFrom } from "../src/agent/recovery";
import type { PluginAgentRoleDef } from "../src/agent/sequencer";

let work = "";
let logPath = "";

const REPORT = "## 结论\n- 读完了。\n\n## 证据路径\n- a.ts:1\n\n## 风险\n- 低。\n\n## 未决问题\n- 无。";
const doneScript = (): ReturnType<typeof scriptedWorkerModel> =>
  scriptedWorkerModel([{ type: "assistant_message", content: REPORT }]);

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "worker-role-test-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

function makeOrch(over: {
  roleFor?: (invoke: string) => PluginAgentRoleDef | null;
} = {}): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: work,
    parentMode: "default",
    modelFor: () => doneScript(),
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    ...(over.roleFor ? { agentRoleFor: over.roleFor } : {}),
  });
  return { orch, events };
}

const spawnedOf = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: "agent_spawned" }> => e.type === "agent_spawned");

describe("spawn_agent 的 role 参数", () => {
  it("点名的角色随 agent_spawned 落流，且**不改** args 里的 mode（角色不给写权限）", async () => {
    const { orch, events } = makeOrch();
    const r = await orch.spawn({ mode: "read", task: "调研 a.ts", role: "review" }, { callId: "c1" });
    expect(r.ok, r.output).toBe(true);
    const spawned = spawnedOf(events);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.role).toBe("review");
    // 角色自带的 mode 不参与本路径（mode 只由 args 与权限档决定）——否则一次点名就能把只读 worker 升成写盘
    expect(spawned[0]?.mode).toBe("read");
    await orch.waitAll(5_000);
  });

  it("不传 role ⇒ 事件里连 `role` 这个键都没有（缺席=没带角色面，不写空串也不写 default）", async () => {
    const { orch, events } = makeOrch();
    const r = await orch.spawn({ mode: "read", task: "调研 b.ts" }, { callId: "c2" });
    expect(r.ok, r.output).toBe(true);
    const spawned = spawnedOf(events);
    expect(spawned).toHaveLength(1);
    expect("role" in (spawned[0] ?? {})).toBe(false);
    await orch.waitAll(5_000);
  });

  it("未注册的角色出声拒：不落 agent_spawned、不建 worker，并指回缺省行为", async () => {
    const { orch, events } = makeOrch();
    const r = await orch.spawn({ mode: "read", task: "调研 c.ts", role: "no-such-role" }, { callId: "c3" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("角色不可用");
    expect(r.output).toContain("不传 role");
    expect(spawnedOf(events)).toHaveLength(0);
    // 「没建 worker」看得见的形状：既不落 agent_status，也不落 agent_result
    expect(events.filter((e) => e.type === "agent_status" || e.type === "agent_result")).toHaveLength(0);
  });

  it("插件形态角色与 sequencer 共用同一份解析（agentRoleFor 命中才放行，未命中即拒）", async () => {
    const def: PluginAgentRoleDef = {
      name: "critic",
      body: "只挑毛病，不给方案。",
      frontmatter: { disallowedTools: "run_shell" },
    };
    const hit = makeOrch({ roleFor: () => def });
    const ok = await hit.orch.spawn({ mode: "read", task: "评审 d.ts", role: "p:critic" }, { callId: "c4" });
    expect(ok.ok, ok.output).toBe(true);
    expect(spawnedOf(hit.events)[0]?.role).toBe("p:critic");
    await hit.orch.waitAll(5_000);

    const miss = makeOrch({ roleFor: () => null });
    const bad = await miss.orch.spawn({ mode: "read", task: "评审 e.ts", role: "p:ghost" }, { callId: "c5" });
    expect(bad.ok).toBe(false);
    expect(bad.output).toContain("未注册");
  });

  it("空串/空白 role 与不传同义（不因此拒，也不落一个空角色）", async () => {
    const { orch, events } = makeOrch();
    const args: SpawnArgs = { mode: "read", task: "调研 f.ts", role: "   " };
    const r = await orch.spawn(args, { callId: "c6" });
    expect(r.ok, r.output).toBe(true);
    expect("role" in (spawnedOf(events)[0] ?? {})).toBe(false);
    await orch.waitAll(5_000);
  });
});

const critic: PluginAgentRoleDef = { name: "critic", body: "只挑毛病。", frontmatter: {} };

describe("崩溃恢复带角色（§4.4.9：重派 = 按原 spawn 参数）", () => {
  it("respawnArgsFrom 把 role 映射进重派参数；源事件没 role ⇒ 键缺席（不替它编一个默认角色）", () => {
    const withRole = respawnArgsFrom({
      type: "agent_spawned", agent_id: "w1", parent_event_id: 1, mode: "read", task: "评审",
      max_turns: 5, permission_mode: "default", role: "review",
    } as AgentSpawnedEvent);
    expect(withRole.role).toBe("review");
    const without = respawnArgsFrom({
      type: "agent_spawned", agent_id: "w2", parent_event_id: 1, mode: "read", task: "调研",
      max_turns: 5, permission_mode: "default",
    } as AgentSpawnedEvent);
    expect("role" in without).toBe(false);
  });

  it("真链：落流的角色 → respawnArgsFrom → respawn() 的新 agent_spawned 仍带同一角色（全新 agent_id）", async () => {
    const first = makeOrch({ roleFor: () => critic });
    const ok = await first.orch.spawn({ mode: "read", task: "评审 x.ts", role: "p:critic", max_turns: 5 }, { callId: "c7" });
    expect(ok.ok, ok.output).toBe(true);
    const origin = spawnedOf(first.events)[0]!;
    await first.orch.waitAll(5_000);

    const second = makeOrch({ roleFor: () => critic });
    const r = await second.orch.respawn(respawnArgsFrom(origin), { callId: "c8" });
    expect(r.ok, r.output).toBe(true);
    const again = spawnedOf(second.events);
    expect(again).toHaveLength(1);
    // 角色没在中间那一跳掉出来，且没有顺手把 mode 换掉（重派不得扩权）
    expect(again[0]?.role).toBe("p:critic");
    expect(again[0]?.mode).toBe("read");
    expect(again[0]?.max_turns).toBe(5);
    expect(again[0]?.agent_id).not.toBe(origin.agent_id);
    await second.orch.waitAll(5_000);
  });

  it("恢复时角色已不可注册 ⇒ 重派出声拒、不建 worker（静默退回默认面 = 换了角色面还不吭声）", async () => {
    const { orch, events } = makeOrch({ roleFor: () => null });
    const r = await orch.respawn({ mode: "read", task: "评审 y.ts", role: "p:ghost" }, { callId: "c9" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("角色不可用");
    expect(spawnedOf(events)).toHaveLength(0);
    expect(events.filter((e) => e.type === "agent_status" || e.type === "agent_result")).toHaveLength(0);
  });
});
