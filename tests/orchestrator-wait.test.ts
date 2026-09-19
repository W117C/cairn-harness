// 收队等待的编排器面：真 Orchestrator + 脚本化 worker 模型（零网络，临时目录）。
// 形状照 tests/agents.test.ts 的 makeOrch/hangModel 先例，不复用其夹具以免跨文件耦合。
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";

let work: string;
let logPath: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "join-wait-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});
afterEach(async () => { await rm(work, { recursive: true, force: true }).catch(() => {}); });

const REPORT = "## 结论\n- 查完了。\n\n## 证据路径\n- src/a.ts:1\n\n## 风险\n- 无。\n\n## 未决问题\n- 无。";
// 剧本必须自带 usage 事件：w.usage 只由子流的 usage 累加（orchestrator 的 workerPipeline），
// 不给 ⇒ 断言用量就成了「测了个 0」。
const doneModel = (): ReturnType<typeof scriptedWorkerModel> =>
  scriptedWorkerModel([
    { type: "assistant_message", content: REPORT },
    { type: "usage", inputTokens: 5, outputTokens: 7 },
  ]);

function makeOrch(model: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel>) {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath, workspace: work, parentMode: "auto",
    emit: async (e) => { events.push(e); await createEventLog(logPath).append(e); },
    modelFor: model,
  });
  return { orch, events };
}

/** 挂起模型：吐完交付文本后停在 promise 上（worker 保持未终态，供超时/取消判定）。 */
function hangUntilRelease(release: Map<string, () => void>) {
  return (args: SpawnArgs): ReturnType<typeof scriptedWorkerModel> =>
    (async function* () {
      yield { type: "assistant_message", content: REPORT } as unknown as AgentEvent;
      yield { type: "usage", inputTokens: 1, outputTokens: 1 } as unknown as AgentEvent;
      await new Promise<void>((res) => release.set(String(args.task), res));
    }) as unknown as ReturnType<typeof scriptedWorkerModel>;
}

describe("waitForAgents", () => {
  it("无 worker ⇒ 立即返回空批（零行为：不占轮、不建等待项）", async () => {
    const { orch } = makeOrch(doneModel);
    const out = await orch.waitForAgents([], 5_000);
    expect(out.rows).toEqual([]);
    expect(out.timedOut).toEqual([]);
  });

  it("read worker 收敛后：默认等全部 ⇒ 拿到 done 行 + summary + usage", async () => {
    const { orch } = makeOrch(doneModel);
    const r = await orch.spawn({ mode: "read", task: "调研 a" }, { callId: "s1" });
    expect(r.ok).toBe(true);
    const id = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    const out = await orch.waitForAgents([], 10_000);
    const row = out.rows.find((x) => x.agent_id === id);
    expect(row?.status).toBe("done");
    expect(row?.summary).toContain(REPORT.split("\n")[1]!.slice(2)); // 「查完了。」
    expect(row?.usage).toEqual({ inputTokens: 5, outputTokens: 7 });   // 剧本给多少就是多少
  });

  it("未知 id fail-visible 摘出（喂进 waitForAgentTerminal 会永挂 + 泄漏等待项）", async () => {
    const { orch } = makeOrch(doneModel);
    const p = orch.waitForAgents(["nope-9"], 2_000);
    const out = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 4_000))]);
    expect(out).not.toBeNull();                       // 没挂死
    expect(out!.rows[0]?.status).toBe("unknown");
    expect(out!.timedOut).toEqual([]);                // unknown ≠ 超时：它是问错了
  });

  it("超时：未收敛的 id 进 timedOut，已收敛的照常带 summary（超时不算失败）", async () => {
    const release = new Map<string, () => void>();
    const mixed = (args: SpawnArgs): ReturnType<typeof scriptedWorkerModel> =>
      String(args.task) === "先收" ? doneModel() : hangUntilRelease(release)(args);
    const { orch, events } = makeOrch(mixed);
    await orch.spawn({ mode: "read", task: "先收" }, { callId: "s1" });
    await orch.spawn({ mode: "read", task: "吊着" }, { callId: "s2" });
    // 等到「一个已终态、另一个确实挂在半路」这个前提成立再测——否则断言测的是时序不是行为。
    const hasDone = (): boolean =>
      events.some((e) => e.type === "agent_result" && (e as { status?: string }).status === "done");
    for (let i = 0; i < 80 && !(release.has("吊着") && hasDone()); i++) await new Promise((r) => setTimeout(r, 25));
    expect(release.has("吊着")).toBe(true);
    expect(hasDone()).toBe(true);
    const out = await orch.waitForAgents([], 300);
    expect(out.timedOut).toHaveLength(1);
    const doneRows = out.rows.filter((r) => r.status === "done");
    expect(doneRows).toHaveLength(1);
    expect(doneRows[0]!.summary).toContain("查完了。");
    expect(out.rows.find((r) => r.status === "running")?.summary).toBe("");
    for (const f of release.values()) f();
  });

  it("取消信号 ⇒ 立即收束并标 cancelled（不等满 timeout，也不动 worker）", async () => {
    const release = new Map<string, () => void>();
    const { orch } = makeOrch(hangUntilRelease(release));
    const r = await orch.spawn({ mode: "read", task: "吊着" }, { callId: "s1" });
    const id = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const started = Date.now();
    const out = await orch.waitForAgents([], 60_000, ctrl.signal);
    expect(out.cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);   // 60s 内回来即证 abort 生效
    // 取消只结束这次等待：未收敛者由行状态呈现（timedOut 是「超时」专用面，不搭车）
    expect(out.timedOut).toEqual([]);
    expect(out.rows.find((x) => x.agent_id === id)?.status).toBe("running");
    for (const f of release.values()) f();
  });
});
