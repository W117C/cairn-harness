// 判卷 · 链内写租约（第 40 页 §四 2 立案，任务 #16）
//
// 实测形状（真轨迹 `outputs/ga-strategy-2026-09-20-rep3/supervise.events.jsonl`）：模型发
// `{mode:"supervise", resources:["src/cart.js","src/totals.js","src/shipping.js"], …}`——
// 它**照规格申报了写面**（规格原文：「与活跃写 worker 相交即拒」），而
// `spawnPipeline` 只拿 resources 算一次审批卡上的警告、`spawnSupervise` 连这一步都没有，
// 逐环 `stageArgs` 一律不带它 ⇒ 环 worker 登记的是**空租约**。
// 后果不是"少一行提示"：`leaseConflicts()` 扫的是活跃 write worker 的 `resources`，
// 链在写盘而登记表上什么都没有 ⇒ 第二条链 / 另一个 write worker 同期改同一批文件时**看不见冲突**，
// 而用户刚在卡上读到的是"已按租约检查过"。这是本仓点名的「读了是为了警示，没进约束」那一格。
//
// 本文件钉的是不变量的**位置**：租约在环活着的那段时间里，对** outgoing 查询**与** incoming 派活**
// 两侧都真可见——不是数一张卡上印了什么。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { gateToolSpecs } from "../src/agent/session-provider";
import { Orchestrator, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";

const exec = promisify(execFile);
let work = "";
let repo = "";
let logPath = "";

// 本文件故意把环挂在 tool_call 上 ⇒ `orch.spawn(...)` 是**游离**的（`void` 掉的那个 promise）。
// 游离不等于可以不结：`cancelAll()` 之后它还要走 `cleanupSuperseded → cleanupWrite → emit`，
// 而 `emit` 写的是本用例的 `work/events.jsonl`。原来 `afterEach` 直接 `rm(work)` ⇒ 全量并发下
// 那条 append 撞上已消失的目录：2567 条断言全绿，vitest 仍以「Unhandled Rejection 1」退出 1（第 109 页实测）。
const detached: Promise<unknown>[] = [];
const DETACH_BOUND_MS = 5_000;
function detach(p: Promise<unknown>): void { detached.push(p); }

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "chain-lease-"));
  repo = join(work, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...a: string[]): Promise<{ stdout: string }> => exec("git", a, { cwd: repo });
  await g("init");
  await g("config", "user.email", "chain-lease@test.local");
  await g("config", "user.name", "Chain Lease Test");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await g("add", ".");
  await g("commit", "-m", "init");
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});
afterEach(async () => {
  const pending = detached.splice(0, detached.length);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    Promise.allSettled(pending),
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), DETACH_BOUND_MS); }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  await rm(work, { recursive: true, force: true }).catch(() => {});
  // 两侧都要出声：没落地＝有环没被收队（下一轮它会把审计写进已经不存在的目录）；
  // 落地但被拒＝真错误，今天它只以"进程级 Unhandled Rejection"的形式冒出来，用例仍然全绿。
  expect(settled !== null, "游离的 spawn 链在 " + String(DETACH_BOUND_MS) + "ms 内没落地 ⇒ 有环没被 cancelAll 收队").toBe(true);
  const rejected = (settled ?? []).filter((s) => s.status === "rejected");
  expect(rejected.length, "游离的 spawn 链被拒绝：" + rejected.map((s) => String((s as PromiseRejectedResult).reason)).join(" | ")).toBe(0);
});

function makeOrch(hang: Map<string, () => void>, approvalTimeoutMs = 20_000): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath, workspace: repo, parentMode: "default", approvalTimeoutMs,
    // 环挂在一个 tool_call 上：worker 保持 running ⇒ 这一段时间里租约**应当**是活的。
    // 收束版（scriptedWorkerModel 直接吐报告）量不到"活着的时候"，只量得到"曾经有过"。
    modelFor: (a: SpawnArgs) => {
      const task = String(a.task ?? "x").slice(0, 24);
      return (async function* () {
        yield { type: "tool_call", id: "c-" + task, name: "read_file", args: { path: "src/a.ts" } } as AgentEvent;
        await new Promise<void>((resolve) => { hang.set(task, () => { hang.delete(task); resolve(); }); });
        yield { type: "assistant_message", content: "verdict: pass\n改了什么：无。风险：低。" } as AgentEvent;
      }) as unknown as ReturnType<typeof scriptedWorkerModel>;
    },
    emit: async (e) => { events.push(e); await createEventLog(logPath).append(e); },
  });
  return { orch, events };
}

async function waitFor(pred: () => boolean, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return pred();
}
const approvals = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: "approval_requested" }> => e.type === "approval_requested");
/** 环的 agent_id 由 `nextAgentId()` 发号（`worker-N`），**不等于** sequencer 拼的 callId
 *  （拿 callId 去等 agent_spawned 会永挂——第一次跑就踩了，故把取法写成一处）。 */
const firstRingId = (events: AgentEvent[]): string => {
  const e = events.find((x) => x.type === "agent_spawned");
  return e && "agent_id" in e ? String(e.agent_id) : "";
};

describe("链的环 worker 真持有申报的写租约", () => {
  it("pipeline：整链申报 resources ⇒ 环的 agent_spawned 带它，且环活着时 leaseConflicts 认得它", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch(hang);
    detach(orch.spawn({
      mode: "pipeline", resources: ["src/**"], stages: [{ role: "implement", task: "改 src/a.ts" }],
    } as SpawnArgs, { callId: "pipe-lease" }));
    expect(await waitFor(() => approvals(events).length >= 1, 4000), "链审批没出现").toBe(true);
    orch.decideWorkerApproval(approvals(events)[0]!.id, true, "once");
    expect(await waitFor(() => events.some((e) => e.type === "agent_spawned"), 4000), "环没起来").toBe(true);
    const ringId = firstRingId(events);
    const spawned = events.find((e) => e.type === "agent_spawned") as Extract<AgentEvent, { type: "agent_spawned" }>;
    expect(spawned.resources, "环登记的是空租约 ⇒ 链在写盘而登记表上什么都没有").toEqual(["src/**"]);
    expect(orch.leaseConflicts(["src/a.ts"]).map((c) => c.agentId), "incoming 查询看不见这条链").toContain(ringId);
    for (const release of [...hang.values()]) release();
    await orch.cancelAll();
  }, 20_000);

  it("supervise：受限循环的环同样持有（真轨迹那次就是这么申报的）", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch(hang);
    detach(orch.spawn({
      mode: "supervise", task: "修三处计价 bug", resources: ["src/a.ts"], supervise: { maxStages: 2 },
    } as SpawnArgs, { callId: "sup-lease" }));
    expect(await waitFor(() => approvals(events).length >= 1, 4000)).toBe(true);
    orch.decideWorkerApproval(approvals(events)[0]!.id, true, "once");
    expect(await waitFor(() => events.some((e) => e.type === "agent_spawned"), 4000), "环没起来").toBe(true);
    expect(orch.leaseConflicts(["src/a.ts"]).map((c) => c.agentId), "supervise 的写面对别的派活不可见")
      .toContain(firstRingId(events));
    for (const release of [...hang.values()]) release();
    await orch.cancelAll();
  }, 20_000);

  it("约束的另一侧：环活着时，另派一个相交的 write worker 会撞到租约审批卡（不是默默并发放行）", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch(hang);
    detach(orch.spawn({
      mode: "pipeline", resources: ["src/**"], stages: [{ role: "implement", task: "改 src/a.ts" }],
    } as SpawnArgs, { callId: "pipe-clash" }));
    await waitFor(() => approvals(events).length >= 1, 4000);
    orch.decideWorkerApproval(approvals(events)[0]!.id, true, "once");
    await waitFor(() => events.some((e) => e.type === "agent_spawned"), 4000);
    const incoming = orch.spawn({ mode: "write", task: "也改 src/a.ts", resources: ["src/a.ts"] } as SpawnArgs, { callId: "in-1" });
    expect(await waitFor(() => approvals(events).some((a) => a.args_digest.includes("resources 相交")), 4000),
      "第二条派活没被告知有人正在写同一面").toBe(true);
    orch.decideWorkerApproval(approvals(events).find((a) => a.args_digest.includes("resources 相交"))!.id, true, "once");
    for (const release of [...hang.values()]) release();
    await orch.cancelAll();
    await incoming;
  }, 20_000);

  it("反向那一格：没申报 resources ⇒ 环不落 resources 字段、不凭空占租约（零申报零行为）", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch(hang);
    detach(orch.spawn({ mode: "pipeline", stages: [{ role: "implement", task: "改 src/a.ts" }] } as SpawnArgs, { callId: "pipe-bare" }));
    await waitFor(() => approvals(events).length >= 1, 4000);
    orch.decideWorkerApproval(approvals(events)[0]!.id, true, "once");
    await waitFor(() => events.some((e) => e.type === "agent_spawned"), 4000);
    const spawned = events.find((e) => e.type === "agent_spawned") as Extract<AgentEvent, { type: "agent_spawned" }>;
    expect(spawned.resources, "没申报却出现租约 = 替模型决定它要写哪").toBeUndefined();
    expect(orch.leaseConflicts(["src/a.ts"])).toEqual([]);
    for (const release of [...hang.values()]) release();
    await orch.cancelAll();
  }, 20_000);

  it("resources 从此是 supervise 读的键 ⇒ 单独申报它不再被拒（第 40 页那格的反向侧）", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch(hang, 300); // 让它自己到期拒绝：本条只验「参数面放行到哪一步」
    const r = await orch.spawn({ mode: "supervise", task: "改一点", resources: ["src/a.ts"] } as SpawnArgs, { callId: "sup-ok" });
    expect(r.output).not.toContain("不读");
    expect(r.output).toContain("未获批准"); // 没决议 ⇒ 走到审批为止（说明它已过了参数面）
    await orch.cancelAll();
    expect(approvals(events).length).toBe(1);
  }, 20_000);

  it("只读环不挂空租约：链声明了 resources 而环是 review ⇒ 环上没有它，也不占面", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch(hang);
    void orch.spawn({
      mode: "pipeline", resources: ["src/**"], stages: [{ role: "review", task: "只读评审 src/a.ts" }],
    } as SpawnArgs, { callId: "pipe-read" });
    await waitFor(() => approvals(events).length >= 1, 4000);
    orch.decideWorkerApproval(approvals(events)[0]!.id, true, "once");
    await waitFor(() => events.some((e) => e.type === "agent_spawned"), 4000);
    const spawned = events.find((e) => e.type === "agent_spawned") as Extract<AgentEvent, { type: "agent_spawned" }>;
    expect(spawned.mode).toBe("read");
    expect(spawned.resources, "只读环挂一份不会生效的租约 = 事件里写一个假面").toBeUndefined();
    expect(orch.leaseConflicts(["src/a.ts"])).toEqual([]);
    for (const release of [...hang.values()]) release();
    await orch.cancelAll();
  }, 20_000);
});

// 规格那句是对**模型**的承诺。取证时它的原文是「mode=write 的写租约 glob（与活跃写 worker 相交即拒）」——
// 两处都和实现不符：租约不止 write 一档登记，相交也不是"即拒"（是审批卡点名、可强行批准）。
// 承诺过严会让模型以为报了 resources 就有硬闸，从而不去看真正保护它的那一层（worktree 隔离）。
describe("规格承诺与实现对齐", () => {
  const resourceDesc = (): string => {
    const spec = gateToolSpecs("auto").find((s) => s.function.name === "spawn_agent");
    const props = (spec!.function.parameters as { properties?: Record<string, { description?: string }> }).properties!;
    return props.resources?.description ?? "";
  };
  it("不再写「相交即拒」，改说审批卡点名（与可强行批准）", () => {
    const d = resourceDesc();
    expect(d).toBeTruthy();
    expect(d).not.toContain("即拒");
    expect(d).toContain("审批卡");
  });
  it("反向那一半：相交确实会出卡（这句不是文字游戏，由上面那条 4 号用例端到端钉住）", () => {
    // 只在这里断"文案说点名"这一面，硬约束那一面交给 leaseConflicts 用例——两处各测各的，
    // 才不会出现"改文案就全绿"的空载判据。
    expect(resourceDesc()).toContain("点名");
  });
});
