// 编排侧「这一次扩张压根没派发出 worker」现在有一列结构证人（`tool_result.hold`）。
//
// 这一格从前只有散文：`[budget]`／「并发已达上限」／「主会话已取消」／`reason=dependency_failed`。
// 后果有两层——⑴ 下游要归因只能回去匹配文案，而文案刚被证明是第二个注入面；⑵ 生产端自己也这么干：
// `triggerDeferredSpawn` 拿 `r.output.includes("并发")` 反推原因，一句文案改字判读就静默换档，
// 而嗅不出来的那两挡（取消／整链）被兜底成 `dependency_failed`——**一个从来没被任何用例钉过的错格**。
//
// 三条纪律带着：
// ⑴ 每挡走**真 orchestrator**，不读源码字符串（规则 236：同文件文字判卷恒真）；
// ⑵ 反面必须钉住：参数写错的拒绝、worker 自己跑回来的红，都**不许**带 `hold`——
//    否则这一列退化成"所有红都是 harness 按住的"，比没有更糟（与 `blockedBy` 同一口径）；
// ⑶ 接线那一半走真 `runLoop`：返回体上的 `hold` 有没有活到落盘面，是另一种坏法。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, HARNESS_HOLD_REASONS, type AgentEvent, type ToolResultEvent } from "../src/events";
import {
  Orchestrator,
  scriptedWorkerModel,
  type OrchestratorOptions,
  type SpawnArgs,
} from "../src/agent/orchestrator";
import { runLoop, type LoopOptions } from "../src/agent/loop";

const exec = promisify(execFile);
const ORCH_SRC = readFileSync(fileURLToPath(new URL("../src/agent/orchestrator.ts", import.meta.url)), "utf8");

let work = "";
let repo = "";
let logPath = "";

// 仓库面在 beforeAll 建一次：这一支全是只读 worker 与纯判定，没有写侧，共享不互相污染。
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "hold-witness-"));
  repo = join(work, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...a: string[]): Promise<{ stdout: string }> => exec("git", a, { cwd: repo });
  await g("init");
  await g("config", "user.email", "hold@test.local");
  await g("config", "user.name", "Hold Test");
  await writeFile(join(repo, "README.md"), "line1\nline2\n", "utf8");
  await g("add", ".");
  await g("commit", "-m", "init");
  logPath = join(work, "events.jsonl");
});

beforeEach(async () => {
  await writeFile(logPath, "", "utf8"); // 每支用例一份干净流：replay 类读者（竞速轮）只看得到自己的料
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

function makeOrch(
  over: {
    events?: AgentEvent[];
    model?: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel>;
    budget?: OrchestratorOptions["budget"];
  } = {},
): { orch: Orchestrator; events: AgentEvent[] } {
  const events = over.events ?? [];
  const orch = new Orchestrator({
    logPath,
    workspace: repo,
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    ...(over.model ? { modelFor: over.model } : {}),
    ...(over.budget !== undefined ? { budget: over.budget } : {}),
  });
  return { orch, events };
}

/** 挂起模型：第一轮 yield 一个 tool_call 后停在 promise 上；放行值在 `hang` 里（按出现顺序取）。 */
function makeHangModel(hang: Map<string, () => void>): (args: SpawnArgs) => ReturnType<typeof scriptedWorkerModel> {
  return (args) => {
    const task = String(args.task ?? "x");
    let armed = false;
    return (async function* () {
      if (!armed) {
        armed = true;
        yield { type: "tool_call", id: "t-" + task, name: "read_file", args: { path: "README.md" } } as AgentEvent;
        await new Promise<void>((resolve) => {
          hang.set(task, () => {
            hang.delete(task);
            resolve();
          });
        });
      }
      yield { type: "assistant_message", content: "收束报告。" } as AgentEvent;
    }) as unknown as ReturnType<typeof scriptedWorkerModel>;
  };
}

const REPORT_SCRIPT = [
  { type: "assistant_message", content: "## 结论\n只读调研完成。\nverdict: pass" },
] as unknown as Parameters<typeof scriptedWorkerModel>[0];

const fastModel = (): ReturnType<typeof scriptedWorkerModel> => scriptedWorkerModel(REPORT_SCRIPT);

async function waitFor(pred: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

const agentIdOf = (r: { output: string }): string => (JSON.parse(r.output) as { agent_id: string }).agent_id;
const releaseOne = (hang: Map<string, () => void>): void => {
  const first = hang.values().next().value;
  expect(first, "没有挂起的 worker 可放行 ⇒ 判卷没走到被度量者").toBeTypeOf("function");
  first?.();
};
const resultsFor = (events: AgentEvent[], callId: string): ToolResultEvent[] =>
  events.filter((e): e is ToolResultEvent => e.type === "tool_result" && e.callId === callId);

/** 一条「被按住」的正证：那一笔既是红、也有散文、也有那一列。事件与工具返回体两种载体共用。 */
async function expectHold(ev: { ok: boolean; output: string; hold?: string }, reason: string, prose: string): Promise<void> {
  expect(ev.ok, "按住所致的那一笔必须是红").toBe(false);
  expect(ev.output, "给人看的那半没撤：模型要知道为什么不起 worker").toContain(prose);
  expect(ev.hold, "被按住的因没有结构证人 ⇒ 与旧日志同形").toBe(reason);
}

describe("编排按住的这一次扩张：每挡各有行为证人", () => {
  it("成本闸拒绝的 spawn 回执与出声事件都带 hold=budget", async () => {
    const { orch, events } = makeOrch({ budget: { maxUsd: 0.5, pricePerMTok: 1 }, model: fastModel });
    await orch.appendProtocol({ type: "usage", inputTokens: 700_000, outputTokens: 400_000 } as AgentEvent);
    expect(orch.budgetBlocked()).toBe(true);
    const r = await orch.spawn({ mode: "read", task: "被拒的活" }, { callId: "c-budget" });
    expect(r.ok).toBe(false);
    expect(r.hold, "返回体没有这一列 ⇒ 落盘面也不会有（挂回真 callId 的那一半由下面「接线」那一格钉）").toBe("budget");
    await expectHold(r, "budget", "会话成本超限");
    const side = events.filter((e): e is ToolResultEvent => e.type === "tool_result" && e.callId.startsWith("budget-"));
    expect(side, "成本闸那句自造 callId 的出声事件没落流（它仍在，属仍开的一半）").toHaveLength(1);
    expect(side[0]!.hold).toBe("budget");
  });

  it("并发帽拒绝的 spawn 回执带 hold=concurrency-limit", async () => {
    const hang = new Map<string, () => void>();
    const { orch } = makeOrch({ model: makeHangModel(hang) });
    for (let i = 0; i < 4; i++) {
      const r = await orch.spawn({ mode: "read", task: "占位 worker " + String(i) }, { callId: "cap-" + String(i) });
      expect(r.ok).toBe(true);
      // 等它**真的挂起**再数并发：spawn 返回时子流还没走到第一轮（activeCount 只数在跑的）
      expect(await waitFor(() => hang.size === i + 1)).toBe(true);
    }
    expect(orch.activeCount(), "占位的四个必须都还在跑，否则帽根本不会被撞到").toBe(4);
    const r = await orch.spawn({ mode: "read", task: "第五个" }, { callId: "cap-5" });
    expect(r.ok).toBe(false);
    await expectHold(r, "concurrency-limit", "并发已达上限");
    for (const f of [...hang.values()]) f();
    await orch.waitAll(20_000);
  }, 30_000);

  it("竞速并发预算不足的回执带 hold=concurrency-limit（同族另一处出口）", async () => {
    const hang = new Map<string, () => void>();
    const { orch } = makeOrch({ model: makeHangModel(hang) });
    const busy = await orch.spawn({ mode: "read", task: "占位 worker" }, { callId: "race-busy" });
    expect(busy.ok).toBe(true);
    expect(await waitFor(() => hang.size === 1)).toBe(true);
    expect(orch.activeCount(), "1 个在跑 + 3 个候选 = 撞到 4 的帽，才走得到这一支").toBe(1);
    const r = await orch.spawnRace("三个候选的活", 3, () => false, { callId: "race-1" });
    expect(r.ok).toBe(false);
    await expectHold(r, "concurrency-limit", "并发预算不足");
    for (const f of [...hang.values()]) f();
    await orch.waitAll(20_000);
  }, 30_000);

  it("主会话已取消后的 spawn 回执带 hold=cancelled", async () => {
    const { orch } = makeOrch({ model: fastModel });
    orch.cancelAll();
    const r = await orch.spawn({ mode: "read", task: "取消之后" }, { callId: "c-cancel" });
    expect(r.ok).toBe(false);
    await expectHold(r, "cancelled", "主会话已取消");
  });

  it("cancelAll 撤销未触发的后环：落流的 tool_result 带 hold=cancelled", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch({ model: makeHangModel(hang) });
    const rA = await orch.spawn({ mode: "read", task: "前环任务A" }, { callId: "a1" });
    const idA = agentIdOf(rA);
    const rB = await orch.spawn({ mode: "read", task: "后环任务B", depends_on: [idA] }, { callId: "b1" });
    expect(rB.ok).toBe(true);
    expect(await waitFor(() => hang.has("前环任务A"))).toBe(true);
    orch.cancelAll();
    expect(await waitFor(() => resultsFor(events, "b1").length === 1)).toBe(true);
    await expectHold(resultsFor(events, "b1")[0]!, "cancelled", "后环 spawn 撤销");
    releaseOne(hang);
    await orch.waitAll(15_000);
  });

  it("前环倒下后的 spawn 回执带 hold=dependency-failed（参数写错的那两支不算按住）", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch({ model: makeHangModel(hang) });
    const rA = await orch.spawn({ mode: "read", task: "前环任务A" }, { callId: "a2" });
    const idA = agentIdOf(rA);
    expect(await waitFor(() => hang.has("前环任务A"))).toBe(true);
    expect(orch.cancelAgent(idA)).toBe(true);
    releaseOne(hang); // 取消于轮界收束：cancelled 终态落流
    expect(await waitFor(() => events.some(
      (e) => e.type === "agent_status" && e.agent_id === idA && e.status === "cancelled",
    ))).toBe(true); // ⚠️ 不是 agent_result：那一列的类型只有 done|failed，取消在它里面长成 failed
    const rC = await orch.spawn({ mode: "read", task: "后环任务C", depends_on: [idA] }, { callId: "c2" });
    expect(rC.ok).toBe(false);
    await expectHold(rC, "dependency-failed", "dependency_failed");
    const ghost = await orch.spawn({ mode: "read", task: "后环任务D", depends_on: ["ghost-1"] }, { callId: "d2" });
    expect(ghost.ok).toBe(false);
    expect(ghost.hold, "参数写错不是 harness 按住 ⇒ 这一格必须缺席").toBeUndefined();
    expect("hold" in ghost, "写了 `hold: undefined` 也算把这一格编出来了").toBe(false);
    await orch.waitAll(15_000);
  });

  it("后环因前环终态被标记 failed：落流带 hold=dependency-failed", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch({ model: makeHangModel(hang) });
    const rA = await orch.spawn({ mode: "read", task: "前环任务A" }, { callId: "a3" });
    const idA = agentIdOf(rA);
    const rB = await orch.spawn({ mode: "read", task: "后环任务B", depends_on: [idA] }, { callId: "b3" });
    expect(rB.ok).toBe(true);
    expect(await waitFor(() => hang.has("前环任务A"))).toBe(true);
    expect(orch.cancelAgent(idA)).toBe(true);
    releaseOne(hang);
    expect(await waitFor(() => resultsFor(events, "b3").length === 1)).toBe(true);
    await expectHold(resultsFor(events, "b3")[0]!, "dependency-failed", "reason=dependency_failed");
    await orch.waitAll(15_000);
  });

  it("整链 failed 的落流带 hold=chain-failed", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch({ model: makeHangModel(hang) });
    const p = orch.spawn({ mode: "pipeline", stages: [{ role: "review", task: "评审环" }] }, { callId: "pipe-9" });
    expect(await waitFor(() => events.some((e) => e.type === "approval_requested"))).toBe(true);
    const apr = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }>;
    expect(orch.decideWorkerApproval(apr.id, true, "once").ok).toBe(true);
    const started = await p;
    expect(started.ok).toBe(true);
    expect(await waitFor(() => events.some((e) => e.type === "agent_spawned"))).toBe(true);
    expect(await waitFor(() => hang.size > 0)).toBe(true);
    const id = (events.find((e) => e.type === "agent_spawned") as Extract<AgentEvent, { type: "agent_spawned" }>).agent_id;
    expect(orch.cancelAgent(id)).toBe(true);
    releaseOne(hang);
    expect(await waitFor(() => resultsFor(events, "pipe-9").length === 1)).toBe(true);
    await expectHold(resultsFor(events, "pipe-9")[0]!, "chain-failed", "整链 failed");
    await orch.waitAll(15_000);
  });

  it("后环被成本闸拒绝：落流的 hold 与散文里的 reason= 由同一处派生", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch({
      budget: { maxUsd: 0.5, pricePerMTok: 1 },
      model: makeHangModel(hang),
    });
    const rA = await orch.spawn({ mode: "read", task: "前环任务A" }, { callId: "a4" });
    const idA = agentIdOf(rA);
    const rB = await orch.spawn({ mode: "read", task: "后环任务B", depends_on: [idA] }, { callId: "b4" });
    expect(rB.ok).toBe(true);
    expect(await waitFor(() => hang.has("前环任务A"))).toBe(true);
    await orch.appendProtocol({ type: "usage", inputTokens: 700_000, outputTokens: 400_000 } as AgentEvent);
    releaseOne(hang); // 前环 done → 事件驱动触发后环 → 成本闸把这一环按住
    expect(await waitFor(() => resultsFor(events, "b4").length === 1)).toBe(true);
    const ev = resultsFor(events, "b4")[0]!;
    expect(ev.hold, "结构那一半").toBe("budget");
    // 散文那一半钉**字面量**：映射表被改动时这条要红（若写成「等于表里那个值」就成了等价突变，规则 259）。
    expect(ev.output, "散文 reason= 与结构列分手了：从前这里靠匹配文案").toContain("reason=budget_exceeded");
    await orch.waitAll(15_000);
  });

  it("反面⑵：worker 自己跑完但没有命中判据，不算被按住", async () => {
    const { orch } = makeOrch({ model: fastModel });
    const r = await orch.spawnRace("没有候选过关的活", 1, () => false, { callId: "race-2" });
    expect(r.ok, "judge 恒假 ⇒ 这条必然收在失败").toBe(false);
    expect(r.output).toContain("无候选 judge 命中");
    expect(r.hold, "跑过了但没过关 ≠ 压根没起").toBeUndefined();
    expect("hold" in r, "写了 `hold: undefined` 也算把这一格编出来了").toBe(false);
    await orch.waitAll(15_000);
  });
});

describe("取值只有一个事实源", () => {
  /** 一条「在写死取值」的行：`hold: "…"` 出现在右手边（条件展开里那种也算）。 */
  const holdLiterals = (src: string): string[] => [...src.matchAll(/\bhold:\s*"([a-z-]+)"/gu)].map((m) => m[1]!);

  it("编排里印出的每个取值都在枚举里，且枚举里没有白写的成员", () => {
    const lits = holdLiterals(ORCH_SRC);
    expect(lits.length, `只从 orchestrator.ts 抽到 ${String(lits.length)} 处取值 ⇒ 尺没接上电`).toBeGreaterThanOrEqual(6);
    for (const v of lits) expect(HARNESS_HOLD_REASONS as readonly string[], `取值「${v}」不在枚举里`).toContain(v);
    expect(new Set(lits).size, `落点只用到 ${String(new Set(lits).size)} 种取值：枚举里有一挡压根没人盖（白写）`).toBe(
      HARNESS_HOLD_REASONS.length,
    );
  });

  it("抽取得不成立时尺要能读到副本形状（负控：判卷不是恒真）", () => {
    expect(holdLiterals('  hold: "made-up-hold",')).toEqual(["made-up-hold"]);
    expect(holdLiterals('        ...(r.hold === undefined ? {} : { hold: r.hold }),')).toEqual([]);
    // 注释里提一句字段名不算取值位
    expect(holdLiterals("// 见 `hold` 的说明")).toEqual([]);
  });

  it("普查的盲区自己讲出来：传播式的 `{ hold: v.hold }` 它数不到（规则 261）", () => {
    // 这一格只数**字面盖章**：dependency-failed 有两处（依赖校验的返回体＋后环落流），
    // 而 spawn／spawnReserved 两处兄弟出口是 `{ hold: v.hold }` 那种传播形状 ⇒ 这把尺看不见它们。
    // 传播那一半的证人是行为用例（前环倒下 → 回执带 dependency-failed），不在这把尺的分母里。
    expect(holdLiterals(ORCH_SRC).filter((v) => v === "dependency-failed"), "两处字面盖章都要在分母里").toHaveLength(2);
    expect([...ORCH_SRC.matchAll(/\{ hold: v\.hold \}/gu)].length, "两处兄弟出口各传播一次").toBe(2);
  });
});

describe("落盘面接线：返回体上的 hold 要活到 tool_result", () => {
  /** 走真 loop：一次 tool_call，工具返回体按参数给。 */
  async function settle(toolResult: { ok: boolean; output: string; hold?: string }): Promise<ToolResultEvent[]> {
    const log: AgentEvent[] = [];
    let first = true;
    await runLoop({
      workspace: "/tmp",
      events: { async append(e) { log.push(e); } },
      tools: { read_file: { name: "read_file", async run() { return toolResult; } } } as never,
      userMessage: "跑一次",
      provider: {
        async *stream() {
          if (first) {
            first = false;
            yield { type: "tool_call", id: "c1", name: "read_file", args: {} } as never;
          }
        },
      },
    } as LoopOptions);
    return log.filter((e): e is ToolResultEvent => e.type === "tool_result");
  }

  it("工具返回体带 hold ⇒ 落盘的 tool_result 也带（否则这一列只活在内存里）", async () => {
    const [hit] = await settle({ ok: false, output: "编排扩张被拒", hold: "budget" });
    expect(hit, "这一路没落 tool_result ⇒ 判卷走的是别的出口").toBeDefined();
    expect(hit.hold).toBe("budget");
  });

  it("工具返回体不带 hold ⇒ 落盘面也不许多出这一格", async () => {
    const [hit] = await settle({ ok: false, output: "普通失败" });
    expect(hit.hold).toBeUndefined();
    expect(Object.keys(hit)).not.toContain("hold");
  });
});

describe("收据挂回接线：worker 收据必须能挂回模型自己的调用（第 245 页）", () => {
  it("diff/merge/wt-cleanup 收据走 receiptCallId（spawnCallId 优先，真零调用才落回派生 id）", () => {
    expect(ORCH_SRC).toContain('callId: this.receiptCallId(w, "diff")');
    expect(ORCH_SRC).toContain('callId: this.receiptCallId(w, "merge")');
    expect(ORCH_SRC).toContain('callId: this.receiptCallId(w, "wt-cleanup")');
    expect(ORCH_SRC).toContain('return w.spawnCallId !== "" ? w.spawnCallId : kind + "-" + w.agentId;');
  });

  it("旧派生 id 不再出现在收据位（反向：换了挂回方式就不许留旧路）", () => {
    expect(ORCH_SRC).not.toContain('"diff-" + w.agentId');
    expect(ORCH_SRC).not.toContain('"wt-cleanup-" + w.agentId');
    expect(ORCH_SRC).not.toContain('"merge-" + agentId');
  });

  it("pipeline 冻结闸拒绝落流直接挂 ctx.callId（与返回体同 id，折叠后一条不丢）", () => {
    expect(ORCH_SRC).toContain("callId: ctx.callId,");
    expect(ORCH_SRC).not.toContain('"pipeline-" + ctx.callId');
  });
});
