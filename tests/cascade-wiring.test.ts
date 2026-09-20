// M5b 级联升级的**产品路径**判据（任务 #45）。
// 修前：runCascade 只有 scripts/routing-check 用 stub  rung 在调，src/ 里零调用者，
// 而 docs/m5-acceptance.md B5 写着「已证」——账面宣称的"便宜档先跑、客观判据判、不过升一级"
// 在产品里从未发生过。这里让那条路必须在真 orchestrator 上被看见：
// 触发只用 worker 自己子流里的 verify_result（模型自报 verdict 不算），阶梯只在同 provider 内取，
// 升上来的那一档必须自己交出绿证据，升不动/升完仍红 ⇒ 整链红，不静默接受。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";
import { worktreePathFor } from "../src/agent/worktree";
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";
import { loadBanditState, newBanditState, saveBanditState } from "../src/routing/bandit";

const specOf = (id: string | undefined): { provider: string; tier: string } | undefined =>
  DEFAULT_MODEL_TABLE.find((s) => s.id === id);

const exec = promisify(execFile);
let work = "";
let repo = "";
let logPath = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "cascade-wire-"));
  repo = join(work, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...a: string[]): Promise<{ stdout: string }> => exec("git", a, { cwd: repo });
  await g("init");
  await g("config", "user.email", "cascade@test.local");
  await g("config", "user.name", "Cascade Test");
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  await g("add", ".");
  await g("commit", "-m", "init");
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

type VerifyHook = {
  maxAttempts?: number;
  surface?: () => Promise<boolean>;
  run: () => Promise<{ ok: boolean; results: { command: string; ok: boolean; output: string }[] }>;
};

function makeOrch(over: {
  model: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel>;
  routing?: boolean;
  cascadeUpgrade?: boolean;
  cascadeMaxUpgrades?: number;
  banditPath?: string;
  workerVerify?: (repoDir: string) => VerifyHook;
}): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: repo,
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    routing: over.routing === true,
    cascadeUpgrade: over.cascadeUpgrade === true,
    ...(over.banditPath !== undefined ? { banditStatePath: over.banditPath } : {}),
    ...(over.cascadeMaxUpgrades !== undefined ? { cascadeMaxUpgrades: over.cascadeMaxUpgrades } : {}),
    modelFor: over.model,
    ...(over.workerVerify ? { workerVerify: over.workerVerify } : {}),
  });
  return { orch, events };
}

async function waitFor(pred: () => boolean, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

const REPORT = "改了什么：新增文件。为什么：任务要求。验证方式：跑过测试。风险：低。";
/** 一次 write_file → 收束报告；文件名按档区分，好把"重跑的是另一档"看出来。 */
function writeScript(path: string): Parameters<typeof scriptedWorkerModel>[0] {
  return [
    { type: "tool_call", id: "w-" + path, name: "write_file", args: { path, content: "x\n" } },
    { type: "assistant_message", content: REPORT },
  ] as unknown as Parameters<typeof scriptedWorkerModel>[0];
}

/** 每次调用换一份 verify 结果。**计数跨 worker 共享**（钩子工厂每个 worker 调一次，
 *  各起各的计数会让升上来的那一档也拿到第一份红 ⇒ 用例看着像"升级没用"）。 */
function hookOf(verdicts: boolean[], counter: { runs: number }): VerifyHook {
  return {
    maxAttempts: 3,
    surface: async () => true,
    run: async () => {
      const ok = verdicts[Math.min(counter.runs, verdicts.length - 1)] ?? false;
      counter.runs++;
      return { ok, results: [{ command: "pnpm test", ok, output: ok ? "All passed" : " Tests 1 failed" }] };
    },
  };
}

async function runPipeline(orch: Orchestrator, events: AgentEvent[], stages: { role: string; task: string }[]): Promise<string> {
  const p = orch.spawn({ mode: "pipeline", stages }, { callId: "pipe-1" });
  expect(await waitFor(() => events.some((e) => e.type === "approval_requested"))).toBe(true);
  const apr = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }>;
  expect(orch.decideWorkerApproval(apr.id, true, "once").ok).toBe(true);
  const r = await p;
  expect(r.ok).toBe(true);
  return (JSON.parse(r.output) as { chain_id: string }).chain_id;
}

const exists = async (p: string): Promise<boolean> =>
  await stat(p).then(() => true).catch(() => false);

describe("级联升级接进产品路径（sequencer 环）", () => {
  it("verify 红 ⇒ 同 provider 升一档重跑，链的终态由最后一档负责，被淘汰那档的 worktree 回收", async () => {
    const verifyRuns = { runs: 0 };
    const { orch, events } = makeOrch({
      routing: true,
      cascadeUpgrade: true,
      model: (a) => scriptedWorkerModel(writeScript(a.model === undefined ? "cheap.txt" : "upgraded.txt")),
      workerVerify: () => hookOf([false, true], verifyRuns), // 首档红 → 升上来的那档绿
    });
    const chainId = await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 done")))).toBe(true);
    await orch.waitAll(20_000);
    const spawned = events.filter((e) => e.type === "agent_spawned") as Extract<AgentEvent, { type: "agent_spawned" }>[];
    expect(spawned).toHaveLength(2); // 一次升级 = 恰好多跑一次，不多不少
    expect(verifyRuns.runs).toBe(2); // 两档各验一次：首档红 → 升上来的那档绿
    expect(events.some((e) => e.type === "agent_message" && (e as { text: string }).text.includes("[cascade]"))).toBe(true);
    const upgraded = events.filter((e) => e.type === "routing_decision") as Extract<AgentEvent, { type: "routing_decision" }>[];
    const cu = upgraded.find((e) => e.reason === "cascade-upgrade");
    expect(cu).toBeDefined();
    expect(cu!.from).toBe("cheap");
    expect(cu!.agent_id).toBe(spawned[1]!.agent_id);
    // 阶梯只在同 provider 内取：跨厂商升档会把一次 BYOK 会话悄悄换成别家的 key
    const first = upgraded.find((e) => e.reason === "tier-default");
    expect(first).toBeDefined();
    expect(specOf(cu!.picked)?.provider).toBe(specOf(first!.picked)?.provider);
    expect(specOf(cu!.picked)?.tier).toBe("standard");
    // 整链快照说"哪个 worker 交付的"必须是最后一档——否则报告与 diff_ref 指向被淘汰那一份
    expect(orch.pipelineSnapshot(chainId)?.state[0]!.agentId).toBe(spawned[1]!.agent_id);
    expect(await exists(worktreePathFor(repo, spawned[0]!.agent_id))).toBe(false);
    expect(await exists(worktreePathFor(repo, spawned[1]!.agent_id))).toBe(true);
  }, 60_000);

  it("worker 没跑过 verify（证据 absent）⇒ 不升级：没有客观判据就不拿猜测换账单", async () => {
    const { orch, events } = makeOrch({
      routing: true,
      cascadeUpgrade: true,
      model: () => scriptedWorkerModel(writeScript("a.txt")), // 无 workerVerify ⇒ 无 verify_result
    });
    await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 done")))).toBe(true);
    const spawned = events.filter((e) => e.type === "agent_spawned");
    expect(spawned).toHaveLength(1);
    expect(events.some((e) => e.type === "agent_message" && (e as { text: string }).text.includes("[cascade]"))).toBe(false);
  }, 60_000);

  it("首档 verify 就绿 ⇒ 一次就跑完（零升级、零额外预算消耗）", async () => {
    const verifyRuns = { runs: 0 };
    const { orch, events } = makeOrch({
      routing: true, cascadeUpgrade: true,
      model: () => scriptedWorkerModel(writeScript("ok.txt")),
      workerVerify: () => hookOf([true], verifyRuns),
    });
    await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 done")))).toBe(true);
    expect(events.filter((e) => e.type === "agent_spawned")).toHaveLength(1);
    expect(verifyRuns.runs).toBe(1); // 绿证据下确实只跑了一遍 verify，没有悄悄重跑
  }, 60_000);

  it("升档升到预算用尽仍红 ⇒ 整链 failed（不静默接受「升过了」），且只多花预算内那几次", async () => {
    const verifyRuns = { runs: 0 };
    const { orch, events } = makeOrch({
      routing: true, cascadeUpgrade: true, cascadeMaxUpgrades: 1,
      model: (a) => scriptedWorkerModel(writeScript(a.model === undefined ? "c.txt" : "s.txt")),
      workerVerify: () => hookOf([false], verifyRuns), // 每一档都红
    });
    await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 failed")))).toBe(true);
    expect(events.filter((e) => e.type === "agent_spawned")).toHaveLength(2); // 1 原始 + 1 升级（预算=1）
    expect(verifyRuns.runs).toBe(2); // 付费重跑的次数 = 预算，不多花
    const fail = events.find((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 failed")) as Extract<AgentEvent, { type: "tool_result" }>;
    expect(fail.output).toContain("仍未拿到绿证据");
  }, 60_000);

  it("升上来的那一档没跑过 verify（absent）⇒ 不算收敛：不花真钱买回一份比触发时更弱的证据", async () => {
    // 按「第几个 worker」而不是 agent_id 判定：agent_id 是模块级自增计数，同文件多条用例连着跑会翻位
    // （worker-10 里含 "worker-1"，按 id 字符串判定会在整跑时静默走偏——单跑绿、整跑红的经典形状）。
    let workersSeen = 0;
    const { orch, events } = makeOrch({
      routing: true, cascadeUpgrade: true, cascadeMaxUpgrades: 2,
      model: (a) => scriptedWorkerModel(writeScript(a.model === undefined ? "c.txt" : "s.txt")),
      // 首档那棵 worktree 有 verify 配置（且判红），升上来的那棵没有 ⇒ 回程证据是 absent。
      // 若把 absent 当「过了」，链会 done 而报告来自一份从没自测过的改动——本仓点名的假绿形状。
      workerVerify: () => {
        workersSeen++;
        const hasJudge = workersSeen === 1;
        return {
          maxAttempts: 3,
          surface: async () => hasJudge,
          run: async () => ({ ok: false, results: [{ command: "pnpm test", ok: false, output: " Tests 1 failed" }] }),
        };
      },
    });
    await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 failed")))).toBe(true);
    expect(events.filter((e) => e.type === "agent_spawned")).toHaveLength(3); // 1 原始 + 预算内 2 档全试过仍无绿证据才红
    const fail = events.find((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 failed")) as Extract<AgentEvent, { type: "tool_result" }>;
    expect(fail.output).toContain("末次证据 absent");
  }, 60_000);

  it("开关关着 ⇒ 与今日逐字同形：红证据也只跑一次、链照常 done（缺省零行为）", async () => {
    const verifyRuns = { runs: 0 };
    const { orch, events } = makeOrch({
      routing: true, // cascadeUpgrade 不给 = 缺省 false
      model: () => scriptedWorkerModel(writeScript("off.txt")),
      workerVerify: () => hookOf([false], verifyRuns),
    });
    await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 done")))).toBe(true);
    expect(events.filter((e) => e.type === "agent_spawned")).toHaveLength(1);
    expect(verifyRuns.runs).toBe(1);
    expect(events.some((e) => e.type === "routing_decision" && (e as { reason: string }).reason === "cascade-upgrade")).toBe(false);
  }, 60_000);

  it("只开 cascadeUpgrade、没开 routing ⇒ 不级联：阶梯起点与升档都靠路由，缺了就等于花两遍钱跑同一模型", async () => {
    const verifyRuns = { runs: 0 };
    const { orch, events } = makeOrch({
      routing: false, cascadeUpgrade: true,
      model: () => scriptedWorkerModel(writeScript("noroute.txt")),
      workerVerify: () => hookOf([false], verifyRuns),
    });
    await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 done")))).toBe(true);
    expect(events.filter((e) => e.type === "agent_spawned")).toHaveLength(1);
    expect(events.some((e) => e.type === "agent_message" && (e as { text: string }).text.includes("[cascade]"))).toBe(false);
    expect(events.filter((e) => e.type === "routing_decision")).toHaveLength(0); // 没路由 ⇒ 零决策事件
  }, 60_000);

  it("升上来的那档直接崩（终态 failed）⇒ 立刻停止爬升：同一环境换一档只会再花一遍钱", async () => {
    const { orch, events } = makeOrch({
      routing: true, cascadeUpgrade: true, cascadeMaxUpgrades: 2,
      // 首档正常跑（判红）→ 升上来的那档模型直接抛 ⇒ 终态 failed，属"另一类失败"
      model: (a) => a.model === undefined
        ? scriptedWorkerModel(writeScript("c.txt"))
        : (async function* () { throw new Error("simulated provider 429"); })() as unknown as ReturnType<typeof scriptedWorkerModel>,
      workerVerify: () => hookOf([false], { runs: 0 }),
    });
    await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 failed")))).toBe(true);
    // 预算 2 却只起了 2 个 worker（1 原始 + 1 升级）：第三档没被拉起来烧钱
    expect(events.filter((e) => e.type === "agent_spawned")).toHaveLength(2);
    const fail = events.find((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 failed")) as Extract<AgentEvent, { type: "tool_result" }>;
    expect(fail.output).toContain("属另一类失败，停止升档");
    expect(fail.output).toContain("升档重跑 1 次"); // 报的是**真起来的**档数，不是 runCascade 的 upgrades 口径
  }, 60_000);

  it("done 但客观证据红 ⇒ bandit 不加分：否则级联越开越学出「便宜但红」的方向", async () => {
    const banditPath = join(work, "routing-bandit.json");
    await saveBanditState(banditPath, newBanditState(42));
    const { orch, events } = makeOrch({
      routing: true, banditPath, // cascadeUpgrade 不开：这条只看学习面，不混进升档
      model: () => scriptedWorkerModel(writeScript("b.txt")),
      workerVerify: () => hookOf([false], { runs: 0 }), // 自报成功 + verify 判红
    });
    await runPipeline(orch, events, [{ role: "implement", task: "写一个文件" }]);
    expect(await waitFor(() => events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("整链 done")))).toBe(true);
    await orch.waitAll(20_000); // 回灌排在 agent_result 之后、closed 之前
    const decision = events.find((e) => e.type === "routing_decision") as Extract<AgentEvent, { type: "routing_decision" }>;
    expect(decision.reason).toBe("bandit");
    const spec = DEFAULT_MODEL_TABLE.find((s) => s.id === decision.picked)!;
    // 臂键 = 「stage|tier」（pipeline 环的 stage 是角色名，不是主会话那条 "default"）
    const post = (await loadBanditState(banditPath)).posteriors["implement|" + spec.tier];
    expect(post).toBeDefined();
    expect(post!.alpha).toBe(2); // reward=0：客观判据红的那一跑不给 α 加分
    expect(post!.beta).toBeGreaterThan(2); // β 照旧吃惩罚 + 真钱代价
  }, 60_000);
});
