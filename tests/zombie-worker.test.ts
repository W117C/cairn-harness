// worker 收尾中途失败 ⇒ 不许留一个**永远成功的僵尸**（2026-10-19 独立评审追出的 HIGH）。
//
// 缺陷形状：`finishInner` 在发 `agent_result` **之前**就把 `w.terminalStatus = "done"` 盖上了；
// `emit(doneResult)` 一抛（磁盘满 / 事件形状非法 / 窗口已销毁），后面那几行
// （lastResult / terminalResolved / resolveTerminalWaiters / resolveDependents）全被跳过 ⇒
//  ① 终态仍读成 "done" ⇒ 父会话拿到 `{"status":"done","summary":""}`——**一句"成功但没有产出"的谎**
//     （那正是 terminal-sync-window 那组判据要防的东西）；
//  ② 耐久日志里只有 agent_status:done、没有 agent_result ⇒ 重启后 interruptedWorkers 看见终态
//     就返回 [] ⇒ 永远补不上 failed(interrupted)；
//  ③ `agentOwners` 与内存回收被跳过 ⇒ 路由表里永远留着这个 agent ⇒ 崩溃恢复的过滤器
//     （`orchestratorForAgent(id) === null`）跳过它 ⇒ 救不回来 ⇒ **僵尸 worker**。
//
// 本组用**真 Orchestrator + 脚本化 worker 模型**，把 emit 做成在 agent_result 上抛。
// 判据是三件事：终态改口成 failed、路由表摘干净、等待方被放行（不是永挂）。
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, orchestratorForAgent, scriptedWorkerModel } from "../src/agent/orchestrator";

let work: string;
let logPath: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "zombie-worker-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});
afterEach(async () => { await rm(work, { recursive: true, force: true }).catch(() => {}); });

const REPORT = "## 结论\n- 查完了。\n\n## 证据路径\n- src/a.ts:1\n\n## 风险\n- 无。\n\n## 未决问题\n- 无。";
const doneModel = (): ReturnType<typeof scriptedWorkerModel> =>
  scriptedWorkerModel([
    { type: "assistant_message", content: REPORT },
    { type: "usage", inputTokens: 5, outputTokens: 7 },
  ]);

describe("worker 收尾中途 emit 失败：终态改口 + 路由表回收（不许留僵尸）", () => {
  it("★emit 在 agent_result 上抛 ⇒ 终态不是 done、路由表摘干净、等待方被放行", async () => {
    const events: AgentEvent[] = [];
    const orch = new Orchestrator({
      logPath, workspace: work, parentMode: "auto",
      emit: async (e) => {
        // 落 agent_result 那一刻失败（磁盘满 / 事件形状非法 / 窗口已销毁）
        if (e.type === "agent_result") throw new Error("模拟落盘失败：磁盘满");
        events.push(e);
        await createEventLog(logPath).append(e);
      },
      modelFor: () => doneModel(),
    });

    const spawned = await orch.spawn({ mode: "read", task: "查一下" }, { callId: "s1" });
    expect(spawned.ok).toBe(true);
    const agentId = (JSON.parse(spawned.output) as { agent_id: string }).agent_id;
    // 等它收束（失败也算收束：等待方必须被放行，不许永挂）
    const out = await orch.waitForAgents([agentId], 10_000);
    const row = out.rows.find((x) => x.agent_id === agentId);
    expect(row, "等待方被永挂了（finish 的 catch 没放行）").toBeDefined();
    expect(row!.status, "终态仍读成 done ⇒ 一句『成功但没有产出』的谎").toBe("failed");

    // 路由表里不能再有这个 agent（否则崩溃恢复的过滤器永远跳过它 ⇒ 僵尸）
    expect(orchestratorForAgent(agentId), "路由表里还留着这个 agent ⇒ 它成了永远救不回来的僵尸").toBeNull();
  });

  it("对照：emit 正常时终态仍是 done（这一格不许被改坏）", async () => {
    const events: AgentEvent[] = [];
    const orch = new Orchestrator({
      logPath, workspace: work, parentMode: "auto",
      emit: async (e) => { events.push(e); await createEventLog(logPath).append(e); },
      modelFor: () => doneModel(),
    });
    const spawned = await orch.spawn({ mode: "read", task: "查一下" }, { callId: "s1" });
    expect(spawned.ok).toBe(true);
    const agentId = (JSON.parse(spawned.output) as { agent_id: string }).agent_id;
    const out = await orch.waitForAgents([agentId], 10_000);
    const row = out.rows.find((x) => x.agent_id === agentId);
    expect(row!.status).toBe("done");
  });
});
