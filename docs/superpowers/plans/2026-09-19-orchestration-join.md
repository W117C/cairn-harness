# W1a 收队工具 + G-B 三处同源静态门 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主会话能真正「收队」——新增 `wait_for_agents` 工具把本批 worker 的终态一次性汇回父上下文，并立一道静态门保证「运行时注入工具」的规格面 / 实例面 / worker 白名单面不再互相缺席。

**Architecture:** 三层，每层一个可独立测的落点。① `src/agent/orchestrator-join.ts` 纯函数（成形 / 帽 / 钳制 / 渲染，零状态零 I/O）；② `Orchestrator.waitForAgents()` 薄方法（只做等待与快照，复用既有 `waitForAgentTerminal`）；③ `src/tools/wait_for_agents.ts` 工具工厂 + 模型可见规格，由 `agent-runner` 的 `installAppTools` 与 `glm-session` 的 `gateToolSpecs` 两头接线。G-B 是一张声明表（`src/agent/tool-surface.ts`）加一支对账测试，**不新增门**——它跑在 `test` 门里（理由见 Global Constraints 末条）。

**Tech Stack:** Node 22 / TypeScript 5（`strict: true`）/ vitest 5（`tests/*.test.ts`，文件级串行）/ Electron 44 壳层的 `src/main/agent-runner.ts`。

**Spec:** `docs/superpowers/specs/2026-09-19-orchestration-design.md` §3 W1a + §7 G-B（诊断 D1 / D2b 与留位 R2 R3 也在该文件；执行前先读它）。

## Global Constraints

以下每条对本计划**全部**任务生效，逐字取自 spec 与 `AGENTS.md`：

1. **只改 harness**；不引入任何前端/后端依赖，不改 `agent-plan.md`（只读权威方案）。
2. **零新事件类型**。W1a 刻意不碰 `src/events/index.ts` 与 `KNOWN_TYPES`，因此**不触两套渲染器**——这是 spec §2 不变量 2「不产生第二事实源」的兑现点。若实现中觉得"加个 `agent_wait` 事件更顺"，停：那会把本任务拖进渲染层并发窗口。
3. **三处同源**：运行时注入工具必须同时出现在 模型可见规格 / 可执行实例 / （worker 可达时）loop 白名单。缺任一处即 G-B 红。
4. **外界文本两头设界**：任何进模型的新文本段带上限 + 如实截断提示 + 一条取回全文的通道。帽一律用现成原语（`src/agent/text-budget.ts`），**不新写第二份裁剪器**。
5. **判卷文件禁改**：`fixtures/todo-app/tests/**`、`fixtures/mock/**`、`scripts/frozen-sha256.json` 一字不动。改判据要走 `BLOCKED.md`，不许改代码去绕。
6. **提交纪律**：一律 `git add <显式文件>`，**禁止目录级 add**（并发会话会往同目录落文件，实测两次把对方的字扫进 HEAD）。变异锚点走**两笔提交**：先「实现 + 测」，后「变异表 +N」（`mutate-verify` 拒绝变异在飞文件，那是正确红不是回归）。
7. **相交检查**：编辑任何已跟踪文件前先 `git diff HEAD -- <该文件>`，非空 ⇒ 那是别人的原子单元，改道 worktree（`.worktrees/join-gb` + `ln -sfn <主树>/node_modules node_modules`），别在主树上叠。
8. **报数前先重测**：本计划引用的符号/行数/帽值是 `4ff7ca8` 时点的观测，**另一会话正以分钟级速度往 `src/agent/*` 落提交**。每个任务开头的 Step 0 就是复认锚点，不复认就动手 = 拿过期前提施工。
9. **门禁判据写在 JS 侧**：命令行排查一律 `grep -E` + `[[:space:]]`，词边界用 `-w`；`\b` / `\s` / `\|` 在 BSD grep 上静默返回空（本仓误判 4 次）。
10. **不新增门**。G-B 落在 `test` 门内的静态对账测，而不是新 `*-check` 脚本——`scripts/gate-manifest.ts` 的 `checkGateManifest` 会把任何 `*-check` 形态脚本强制登记，凭空多一道进程启动换不来分辨力。若执行者改主意要立独立门，须先回本计划改这条。

**测试命令**（沙箱内 `pnpm test` 起不来，一律直连 vitest）：

```bash
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/<文件名>
```

类型检查用 `pnpm typecheck`（`tsc --noEmit` 扫全树，含未跟踪文件 ⇒ 半成品新文件会让它红，宁可写完再跑）。

## File Structure

| 文件 | 动作 | 责任（一句话） |
|---|---|---|
| `src/agent/orchestrator-join.ts` | 新建 | 收队的**纯**数据面：入参形状、逐行帽、整批帽、超时钳制、payload 渲染 |
| `tests/orchestrator-join.test.ts` | 新建 | 上表每条政策各一条测 + 一条 CJK 权重反向对照 |
| `src/agent/orchestrator.ts` | 修改 | 新增 public `waitForAgents()`：把 `waitForAgentTerminal` 接成一个批，含超时/取消/未知 id |
| `tests/orchestrator-wait.test.ts` | 新建 | 真 `Orchestrator` + 脚本化 worker 驱动终态/挂起/取消三条路 |
| `src/tools/wait_for_agents.ts` | 新建 | 工具工厂（参数收窄 fail-visible）+ 模型可见规格 |
| `tests/wait-for-agents-tool.test.ts` | 新建 | 参数收窄、编排器未接线、零 worker、与 `Orchestrator` 的结构兼容性 |
| `src/agent/glm-session.ts` | 修改 | `gateToolSpecs` 追加规格；只读档把 `wait_for_agents` 连同 `remember` 一并摘除 |
| `src/main/agent-runner.ts` | 修改 | `installAppTools` 注入实例（与 `spawn_agent` 同一处） |
| `src/agent/tool-surface.ts` | 新建 | 注入工具的**声明表**（G-B 的事实源，生产与测试同读一份） |
| `tests/tool-surface-parity.test.ts` | 新建 | G-B：三面对账 + 自己的反向对照 |
| `scripts/mutate-verify.mjs` | 修改 | 追加 8 条锚点（一笔独立提交） |
| `docs/superpowers/specs/2026-09-19-orchestration-design.md` | 修改 | 追加两条口径更正（CJK 帽已被 `d98fa19` 解决；W1a 的 `cost_usd` 挪给 W3） |

---

## Task 1: 收队的纯数据面 `orchestrator-join.ts`

**Files:**
- Create: `src/agent/orchestrator-join.ts`
- Test: `tests/orchestrator-join.test.ts`

**Interfaces:**
- Consumes: `estimateTextTokens` / `truncateToTokenBudget`（`src/agent/text-budget.ts`）、`clipWorkerSummary`（`src/agent/worker-report.ts`，`4f66015` 起已按类别权重计量）
- Produces: `JoinInput`、`JoinRow`、`shapeJoinRows(inputs): { rows, degraded }`、`renderJoinPayload(body): string`、`clampWaitTimeout(raw): { ms, clamped, rejected? }`、常量 `WAIT_ROW_TOKEN_CAP` / `WAIT_BATCH_TOKEN_CAP` / `WAIT_TIMEOUT_DEFAULT_MS` / `WAIT_TIMEOUT_MAX_MS`（Task 2/3 全部按这些名字消费）

- [ ] **Step 0：复认锚点**（前提在动）

```bash
grep -nE "^export (function|const)" src/agent/text-budget.ts
grep -n "export function clipWorkerSummary" src/agent/worker-report.ts
git diff HEAD -- src/agent/text-budget.ts src/agent/worker-report.ts   # 必须为空，非空即改道 worktree
```
期望看到 `estimateTextTokens`、`truncateToTokenBudget`、`clampToTokenBudget` 三个导出与 `clipWorkerSummary`。若 `truncateToTokenBudget` 不在了，停下来回 spec 立案，不要去改对方刚落的原语。

- [ ] **Step 1：写失败测试** — `tests/orchestrator-join.test.ts`

```ts
// W1a 收队的纯数据面测：逐行帽 / 整批帽 / 超时钳制 / CJK 权重反向对照 / 取回通道真实存在。
// 纯函数零 I/O ⇒ 不依赖模型与真实 worker（判卷纪律：锚点必须落在有界纯函数面上）。
import { describe, expect, it } from "vitest";
import {
  WAIT_BATCH_TOKEN_CAP, WAIT_ROW_TOKEN_CAP, WAIT_TIMEOUT_DEFAULT_MS, WAIT_TIMEOUT_MAX_MS,
  clampWaitTimeout, renderJoinPayload, shapeJoinRows, type JoinInput,
} from "../src/agent/orchestrator-join";
import { estimateTextTokens } from "../src/agent/text-budget";

function row(agentId: string, report: string): JoinInput {
  return { agentId, status: "done", task: "t-" + agentId, report, usage: { inputTokens: 10, outputTokens: 20 } };
}
const rowsOf = (inputs: JoinInput[]) => shapeJoinRows(inputs).rows;

describe("wait_for_agents 纯数据面", () => {
  it("未超帽时逐字不变（零回归：收队不得改写 worker 的交付文本）", () => {
    const out = rowsOf([row("w1", "结论：改完了。\n证据：src/a.ts:3")]);
    expect(out[0]!.summary).toBe("结论：改完了。\n证据：src/a.ts:3");
    expect(out[0]!.truncated).toBe(false);
  });

  it("单行超帽 ⇒ 截断且提示计入预算（总长仍 ≤ 帽，不是「帽 + 提示」）", () => {
    const out = rowsOf([row("w1", "汉".repeat(WAIT_ROW_TOKEN_CAP * 3))]);
    expect(out[0]!.truncated).toBe(true);
    expect(estimateTextTokens(out[0]!.summary)).toBeLessThanOrEqual(WAIT_ROW_TOKEN_CAP);
  });

  it("整批超帽 ⇒ 后段降级为一行状态并登记 degraded（数量有界 ≠ 体积有界）", () => {
    const big = "字".repeat(WAIT_ROW_TOKEN_CAP);
    const many = Array.from({ length: 8 }, (_, i) => row("w" + String(i), big));
    const { rows, degraded } = shapeJoinRows(many);
    expect(rows).toHaveLength(8);                       // 行不丢：状态必须在，只丢摘要
    expect(degraded.length).toBeGreaterThan(0);
    const total = rows.reduce((n, r) => n + estimateTextTokens(r.summary), 0);
    expect(total).toBeLessThanOrEqual(WAIT_BATCH_TOKEN_CAP);
    for (const id of degraded) expect(rows.find((r) => r.agent_id === id)?.summary).toBe("");
  });

  it("CJK 权重反向对照：500 个汉字必须算 500 token 并被截（旧 chars/4 口径会判它 125 而放过）", () => {
    const out = rowsOf([row("w1", "中".repeat(500))]);
    expect(estimateTextTokens("中".repeat(500))).toBe(500);
    expect(out[0]!.truncated).toBe(true);
  });

  it("被降级的行仍带 status/usage，且 payload 给出真实可执行的取回通道", () => {
    const big = "字".repeat(WAIT_ROW_TOKEN_CAP);
    const { rows, degraded } = shapeJoinRows(Array.from({ length: 8 }, (_, i) => row("w" + String(i), big)));
    const text = renderJoinPayload({ rows, degraded, timedOut: [], cancelled: false });
    expect(text).toContain("[join]");
    expect(text).toContain("wait_for_agents");          // 取回路径 = 单个 agent_id 再调一次
    const parsed = JSON.parse(text.slice(text.indexOf("{"))) as { rows: { usage: unknown }[] };
    expect(parsed.rows[0]!.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("超时：缺省用默认值；过大钳到硬帽并如实报钳制；非数一律 fail-visible 拒绝", () => {
    expect(clampWaitTimeout(undefined)).toEqual({ ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false });
    expect(clampWaitTimeout(99_999_999)).toEqual({ ms: WAIT_TIMEOUT_MAX_MS, clamped: true });
    expect(clampWaitTimeout("120000").rejected).toBeTypeOf("string");
    expect(clampWaitTimeout(0).rejected).toBeTypeOf("string");
  });
});
```

- [ ] **Step 2：跑到红**

```bash
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/orchestrator-join.test.ts
```
期望：整文件红在 `Cannot find module '../src/agent/orchestrator-join'`（模块尚不存在，**不是**断言失败）。

- [ ] **Step 3：写实现** — `src/agent/orchestrator-join.ts`

```ts
// W1a「收队」的纯数据面：把若干 worker 的终态汇成一条给父模型看的 payload。
// 为什么单独一个模块：等待本身（Task 2）几乎没有可测逻辑，值钱的判断全在「怎么在有限字节里
// 如实说完 N 个 worker 干了什么」——放类里就只能起真 worker 才能测，锚点会因宿主差异变未证。
// 帽的口径：逐行帽管单条摘要，整批帽管这一**次调用**的总量。只设前者是本仓点名的
// 「数量有界 ≠ 体积有界」（MAX_CONCURRENT_WORKERS=4 时 4×400 仍会把父上下文塞穿）。
import { clipWorkerSummary } from "./worker-report";
import { estimateTextTokens } from "./text-budget";

/** 单条 worker 摘要上限（token）。`SUMMARY_TOKEN_CAP`(2000) 是给一次 spawn 回执用的，
 *  收队一次最多回 4 个 worker ⇒ 整批帽按 2400、逐行 400，量级与主会话一轮工具结果相称。 */
export const WAIT_ROW_TOKEN_CAP = 400;
/** 整批（一次 wait 调用）摘要总量上限；超出的行只留状态，摘要清空。 */
export const WAIT_BATCH_TOKEN_CAP = 2_400;
export const WAIT_TIMEOUT_DEFAULT_MS = 120_000;
export const WAIT_TIMEOUT_MAX_MS = 600_000;
/** 低于此值等于「不等」，worker 大概率还没收敛 ⇒ 一并拒绝，避免 0/负数变成静默立即返回。 */
const WAIT_TIMEOUT_MIN_MS = 1_000;

export type JoinStatus = "done" | "failed" | "cancelled" | "running" | "unknown";

/** 编排器给它的原始材料（Task 2 从 WorkerHandle / agent_result 里摘出来）。 */
export interface JoinInput {
  agentId: string;
  status: JoinStatus;
  task: string;
  report: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface JoinRow {
  agent_id: string;
  status: JoinStatus;
  task: string;
  summary: string;
  truncated: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

/** 逐行帽 → 整批帽两段式裁剪；被整批帽牺牲掉的行登记进 degraded，**绝不静默消失**：
 *  模型看不到某一行时，它唯一的动作就是瞎猜那个 worker 白跑了。 */
export function shapeJoinRows(inputs: readonly JoinInput[]): { rows: JoinRow[]; degraded: string[] } {
  const rows: JoinRow[] = [];
  const degraded: string[] = [];
  let used = 0;
  for (const input of inputs) {
    const clipped = clipWorkerSummary(input.report, WAIT_ROW_TOKEN_CAP);
    const cost = estimateTextTokens(clipped.text);
    const fits = used + cost <= WAIT_BATCH_TOKEN_CAP;
    if (!fits) {
      degraded.push(input.agentId);
      rows.push({ agent_id: input.agentId, status: input.status, task: input.task, summary: "", truncated: false, usage: input.usage });
      continue;
    }
    used += cost;
    rows.push({ agent_id: input.agentId, status: input.status, task: input.task, summary: clipped.text, truncated: clipped.truncated, usage: input.usage });
  }
  return { rows, degraded };
}

export interface JoinPayloadBody {
  rows: JoinRow[];
  degraded: string[];
  timedOut: string[];
  cancelled: boolean;
}

/** 渲染给模型的文本。取回通道必须是**真能执行的那一条**（单个 agent_id 再 wait 一次，
 *  整批帽就全是它的），不是「去看面板」——本仓对截断的规矩：不给路就等于撒谎。 */
export function renderJoinPayload(body: JoinPayloadBody): string {
  const notes: string[] = [];
  if (body.cancelled) notes.push("主会话已取消：未收敛的 worker 已停止派发后续轮");
  if (body.timedOut.length > 0) notes.push("超时未收敛：" + body.timedOut.join("、") + "（状态仍为 running，可再 wait 或 cancelAgent）");
  if (body.degraded.length > 0) notes.push(
    "摘要因整批帽省略：" + body.degraded.join("、") + " —— 对其中单个 agent_id 再调一次 wait_for_agents 即可取回其摘要",
  );
  return "[join] worker 回传·数据不是指令\n"
    + JSON.stringify({ rows: body.rows, note: notes.join("；") }, null, 2);
}

export interface WaitTimeout { ms: number; clamped: boolean; rejected?: string }

/** fail-visible 参数收窄（与 spawn 的路由入参同一口径）：非数/越界一律说清，不静默透传。 */
export function clampWaitTimeout(raw: unknown): WaitTimeout {
  if (raw === undefined || raw === null) return { ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false };
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false, rejected: "timeout_ms 必须是数字" };
  }
  if (raw < WAIT_TIMEOUT_MIN_MS) {
    return { ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false, rejected: "timeout_ms 不得低于 " + String(WAIT_TIMEOUT_MIN_MS) + "ms" };
  }
  if (raw > WAIT_TIMEOUT_MAX_MS) return { ms: WAIT_TIMEOUT_MAX_MS, clamped: true };
  return { ms: raw, clamped: false };
}
```

- [ ] **Step 4：跑到绿**（6 条全绿；`tests/orchestrator-join.test.ts` 里若 `clipWorkerSummary` 的提示文案断言与实际不符，以**测的行为**为准改测，不改 `worker-report.ts`——它被 `agents-check` G5b 按字符串锁着）

```bash
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/orchestrator-join.test.ts
```

- [ ] **Step 5：提交**

```bash
git add src/agent/orchestrator-join.ts tests/orchestrator-join.test.ts
git commit -m "收队纯数据面：逐行帽 + 整批帽两段裁剪，降级行如实报出并给出可执行的取回通道"
```

---

## Task 2: `Orchestrator.waitForAgents()`（把已有的终态等待接成一个批）

**Files:**
- Modify: `src/agent/orchestrator.ts`「waitForAgentTerminal」所在区（M3c sequencer 同步点）之后追加 public 方法
- Test: `tests/orchestrator-wait.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `JoinInput` / `shapeJoinRows` / `JoinPayloadBody`；类内既有 `workerIds()`、`workers: Map<string, WorkerHandle>`（`finished` / `terminalStatus` / `lastResult` / `usage` / `task` / `mode`）、`waitForAgentTerminal(agentId)`（已终态 ⇒ 立即 resolve）
- Produces: `waitForAgents(ids: string[], timeoutMs: number, signal?: AbortSignal): Promise<JoinPayloadBody>`（Task 3 的工具体唯一调用点）

⚠️ **实现前必须知道的一条坑**：`waitForAgentTerminal` 对**不存在的 agent_id** 会把 resolve 推进 `terminalWaiters` 且永不触发（既不 resolve 也不清理）。所以未知 id 必须在调用前摘掉——这正是第 3 条测试要钉住的东西。

- [ ] **Step 0：复认锚点**

```bash
grep -n "private waitForAgentTerminal" src/agent/orchestrator.ts
grep -n "workerIds()\|terminalStatus" src/agent/orchestrator.ts | head
git diff HEAD -- src/agent/orchestrator.ts   # 必须为空（本文件是全仓改动最频繁面之一）
```

- [ ] **Step 1：写失败测试** — `tests/orchestrator-wait.test.ts`

```ts
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
  ] as unknown as AgentEvent[]);

function makeOrch(model: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel>) {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath, workspace: work, parentMode: "auto",
    emit: async (e) => { events.push(e); await createEventLog(logPath).append(e); },
    modelFor: model,
  });
  return { orch, events };
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
    expect(row?.usage).toEqual({ inputTokens: 5, outputTokens: 7 }); // 剧本给多少就是多少，不是「> 0」糊过去
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
    const hang: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel> = (args) =>
      (async function* () {
        yield { type: "assistant_message", content: REPORT } as unknown as AgentEvent;
        await new Promise<void>((res) => release.set(String(args.task), res));
      }) as unknown as ReturnType<typeof scriptedWorkerModel>;
    const { orch } = makeOrch(hang);
    await orch.spawn({ mode: "read", task: "先收" }, { callId: "s1" });
    await orch.spawn({ mode: "read", task: "吊着" }, { callId: "s2" });
    for (let i = 0; i < 40 && release.size < 2; i++) await new Promise((r) => setTimeout(r, 25));
    const out = await orch.waitForAgents([], 300);
    expect(out.timedOut.length).toBe(1);
    expect(out.rows.filter((r) => r.status === "done").length).toBeGreaterThanOrEqual(1);
    for (const f of release.values()) f();
  });

  it("取消信号 ⇒ 立即收束并标 cancelled（不等满 timeout）", async () => {
    const release = new Map<string, () => void>();
    const hang: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel> = (args) =>
      (async function* () {
        yield { type: "assistant_message", content: REPORT } as unknown as AgentEvent;
        await new Promise<void>((res) => release.set(String(args.task), res));
      }) as unknown as ReturnType<typeof scriptedWorkerModel>;
    const { orch } = makeOrch(hang);
    await orch.spawn({ mode: "read", task: "吊着" }, { callId: "s1" });
    const ctrl = new AbortController();
    const p = orch.waitForAgents([], 60_000, ctrl.signal);
    setTimeout(() => ctrl.abort(), 50);
    const out = await p;                             // 60s 内回来即证 abort 生效
    expect(out.cancelled).toBe(true);
    for (const f of release.values()) f();
  });
});
```

- [ ] **Step 2：跑到红** — 期望 `orch.waitForAgents is not a function`（**不是**上面的断言失败）

- [ ] **Step 3：写实现**（追加在「M3c：sequencer 与 worker 终态的同步点」小节内，紧邻 `waitForAgentTerminal`）

```ts
  /** W1a 收队：等一批 worker 到终态。**不新增事件类型**——父模型看到的就是一条普通 tool_result。
   *  复用 sequencer 的同步点（`waitForAgentTerminal` 已终态即立即返回），因此对已收敛的 worker
   *  重复调用等价于「读一次快照」，这是 `wait_for_agents` 的取回通道能成立的前提。
   *  边界三条都是实测教训：
   *  ① 未知 id 必须先摘——`waitForAgentTerminal` 对不存在的 id 会把 resolve 推进等待表且永不触发；
   *  ② 超时不算失败（本仓对"等人门"的统一口径）：已收敛的照给，未收敛的点名进 timedOut；
   *  ③ abort 只结束这次等待，**不动任何 worker**——取消 worker 是 cancelAgent/cancelAll 的职责，
   *    收队方无权替用户决定杀谁（权限 ≤ 父会话的同一族理由）。 */
  async waitForAgents(ids: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<JoinPayloadBody> {
    const targets = ids.length > 0 ? [...ids] : this.workerIds();
    const known = targets.filter((id) => this.workers.has(id));
    const unknown = targets.filter((id) => !this.workers.has(id));
    const snapshot = (want: string[]): JoinInput[] => want.map((id) => {
      const w = this.workers.get(id);
      if (!w) return { agentId: id, status: "unknown" as const, task: "", report: "未派生过该 agent_id（问错了名字）", usage: { inputTokens: 0, outputTokens: 0 } };
      const r = w.lastResult;
      return {
        agentId: id,
        status: w.finished ? (w.terminalStatus === "failed" ? "failed" as const : w.terminalStatus === "cancelled" ? "cancelled" as const : "done" as const) : "running" as const,
        task: w.task,
        report: r?.summary ?? "",
        usage: { ...w.usage },
      };
    });
    if (targets.length === 0) return { rows: [], degraded: [], timedOut: [], cancelled: false };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const racers: Promise<"done" | "timeout" | "cancelled">[] = [
      Promise.all(known.map((id) => this.waitForAgentTerminal(id))).then(() => "done" as const),
      new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); timer.unref?.(); }),
    ];
    if (signal) {
      racers.push(new Promise<"cancelled">((resolve) => {
        onAbort = () => resolve("cancelled");
        signal.addEventListener("abort", onAbort, { once: true });
      }));
    }
    const outcome = await Promise.race(racers);
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined && signal !== undefined) signal.removeEventListener("abort", onAbort);

    const settled = known.filter((id) => this.workers.get(id)?.finished === true);
    const shaped = shapeJoinRows([...snapshot(settled), ...snapshot(known.filter((id) => !settled.includes(id))), ...snapshot(unknown)]);
    return {
      rows: shaped.rows,
      degraded: shaped.degraded,
      timedOut: outcome === "timeout" ? known.filter((id) => this.workers.get(id)?.finished !== true) : [],
      cancelled: outcome === "cancelled",
    };
  }
```

并在文件头 import 区追加：

```ts
import { shapeJoinRows, type JoinInput, type JoinPayloadBody } from "./orchestrator-join";
```

- [ ] **Step 4：跑到绿**（5 条）。若第 2 条 `summary` 断言不中，先确认 `finish` 的 `agent_result.summary` 是否等于 `lastAssistantText`——**不要**为了让测过去而放宽 `clipWorkerSummary`。

- [ ] **Step 5：类型自检 + 提交**

```bash
pnpm typecheck
git add src/agent/orchestrator.ts tests/orchestrator-wait.test.ts
git commit -m "收队等待接进产品路径：waitForAgents 复用 sequencer 同步点，未知 id 先摘、超时不杀 worker、取消只结束等待"
```

---

## Task 3: 工具面 `wait_for_agents`（工厂 + 模型可见规格）

**Files:**
- Create: `src/tools/wait_for_agents.ts`
- Test: `tests/wait-for-agents-tool.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `waitForAgents(ids, timeoutMs, signal?)`、Task 1 的 `clampWaitTimeout` / `renderJoinPayload` / `JoinPayloadBody`
- Produces: `createWaitForAgentsTool(host: () => WaitForAgentsHost | null): Tool`、`waitForAgentsSpec`（结构同 `SessionPluginTool`：`{ name, description, parameters }`）、常量 `WAIT_FOR_AGENTS_TOOL = "wait_for_agents"`

- [ ] **Step 1：写失败测试** — `tests/wait-for-agents-tool.test.ts`

```ts
// 工具面测：参数收窄 fail-visible、编排器未接线、零 worker 零行为、payload 与规格同源。
// 用结构桩而非真 Orchestrator——工具体只依赖 WaitForAgentsHost 这两样，测才能与编排器解耦。
// 参数非法一律 **throw ToolError**（本仓约定：impact-query / propose_plan 同形，由 loop 在边界转成
// ok:false 的 tool_result）⇒ 单测直调 tool.run 时必须用 rejects.toThrow，不能期待返回值。
import { describe, expect, it } from "vitest";
import { WAIT_FOR_AGENTS_TOOL, createWaitForAgentsTool, waitForAgentsSpec, type WaitForAgentsHost } from "../src/tools/wait_for_agents";
import { gateToolSpecs } from "../src/agent/glm-session";

const hostWith = (calls: unknown[]): WaitForAgentsHost & { calls: unknown[] } => ({
  calls,
  hasWorkers: () => true,
  waitForAgents: async (ids, timeoutMs, signal) => {
    calls.push({ ids, timeoutMs, hasSignal: signal !== undefined });
    return { rows: [{ agent_id: "w1", status: "done", task: "t", summary: "结论", truncated: false, usage: { inputTokens: 1, outputTokens: 2 } }], degraded: [], timedOut: [], cancelled: false };
  },
});
const emptyHost = (): WaitForAgentsHost => ({ hasWorkers: () => false, waitForAgents: async () => { throw new Error("不该被调用"); } });

describe("wait_for_agents 工具", () => {
  it("编排器未接线 ⇒ fail-closed 拒绝（与 spawn_agent 同一措辞族，不静默返回空）", async () => {
    const r = await createWaitForAgentsTool(() => null).run({}, { workspace: "/tmp", callId: "c1" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("编排器未接线");
  });

  it("正常收队：透传 agent_ids / timeout_ms / 取消信号，输出以 [join] 开头", async () => {
    const h = hostWith([]);
    const r = await createWaitForAgentsTool(() => h).run({ agent_ids: ["w1"], timeout_ms: 30_000 }, { workspace: "/tmp", callId: "c1" });
    expect(r.ok).toBe(true);
    expect(r.output.startsWith("[join]")).toBe(true);
    expect(h.calls[0]).toEqual({ ids: ["w1"], timeoutMs: 30_000, hasSignal: false });
  });

  it("零 worker ⇒ 一句话即返，不建等待（省一次模型可见的空对象）", async () => {
    const r = await createWaitForAgentsTool(() => emptyHost()).run({}, { workspace: "/tmp", callId: "c1" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("没有 worker");
  });

  it("非法 timeout_ms 拒绝并把合法区间说清楚（不静默回落缺省）", async () => {
    await expect(
      createWaitForAgentsTool(() => hostWith([])).run({ timeout_ms: "30000" }, { workspace: "/tmp", callId: "c1" }),
    ).rejects.toThrow(/timeout_ms/);
  });

  it("agent_ids 含非字符串 ⇒ 拒绝（JSON 数组里混数字是模型常犯的错，必须点名而不是当未知 id 处理）", async () => {
    await expect(
      createWaitForAgentsTool(() => hostWith([])).run({ agent_ids: [1] }, { workspace: "/tmp", callId: "c1" }),
    ).rejects.toThrow(/agent_ids/);
  });

  it("规格与实例同名同串（两头断是本仓第 5 次复发的缺陷族）", () => {
    expect(waitForAgentsSpec.name).toBe(WAIT_FOR_AGENTS_TOOL);
    expect(waitForAgentsSpec.description).toContain("收队");
    expect(gateToolSpecs("auto").some((s) => s.function.name === WAIT_FOR_AGENTS_TOOL)).toBe(true);
    expect(gateToolSpecs("read-only").some((s) => s.function.name === WAIT_FOR_AGENTS_TOOL)).toBe(false);
  });
});
```

- [ ] **Step 2：跑到红**（模块不存在）

- [ ] **Step 3：写实现** — `src/tools/wait_for_agents.ts`

```ts
// W1a 收队工具：把「派了 worker 却收不回来」这一条结构性缺陷闭合在产品路径上。
// 前车之见：join 原语（Orchestrator.waitAll）一直存在，但调用者全在验收脚本里 ⇒
// 主 agent 派完 worker、说完这轮就结束，永远不被叫回来读团队的产出。
// 注入纪律同 spawn_agent：常驻原语走静态规格表（glm-session）+ 运行期实例（installAppTools），
// 不混 obs_recall/impact_query 那套「按开关注入」——没有开关可关它，关掉就等于没有收队。
import { clampWaitTimeout, renderJoinPayload, type JoinPayloadBody } from "../agent/orchestrator-join";
import { ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";

export const WAIT_FOR_AGENTS_TOOL = "wait_for_agents";

/** 工具体对编排器的全部依赖（结构接口而非 import 类：否则 tools ←→ agent 成环，且测必须起真编排器）。 */
export interface WaitForAgentsHost {
  waitForAgents(ids: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<JoinPayloadBody>;
  /** 零 worker 时给一句话就返，不建任何等待项。 */
  hasWorkers(): boolean;
}

export function createWaitForAgentsTool(host: () => WaitForAgentsHost | null): Tool {
  return {
    name: WAIT_FOR_AGENTS_TOOL,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const orch = host();
      if (!orch) return { ok: false, output: "wait_for_agents: 编排器未接线（fail-closed）" };
      if (!orch.hasWorkers()) return { ok: true, output: "[join] 本会话没有 worker——无需收队，直接继续。" };

      const rawIds = args.agent_ids;
      if (rawIds !== undefined && rawIds !== null && !Array.isArray(rawIds)) throw new ToolError("wait_for_agents: agent_ids 必须是字符串数组");
      const ids = rawIds === undefined || rawIds === null ? [] : (rawIds as unknown[]).map((x, i) => {
        if (typeof x !== "string" || x.trim() === "") throw new ToolError(`wait_for_agents: agent_ids[${String(i)}] 必须是非空字符串`);
        return x;
      });
      const timeout = clampWaitTimeout(args.timeout_ms);
      if (timeout.rejected !== undefined) throw new ToolError("wait_for_agents: " + timeout.rejected);

      const body = await orch.waitForAgents(ids, timeout.ms, ctx.signal);
      const text = renderJoinPayload(body);
      return { ok: true, output: timeout.clamped ? text + "\n[clamp] timeout_ms 超上限，已钳到 " + String(timeout.ms) + "ms" : text };
    },
  };
}

/** 模型可见规格。刻意写短：工具面是按轮重送的固定成本；一句话讲清「什么时候必须用它」。 */
export const waitForAgentsSpec = {
  name: WAIT_FOR_AGENTS_TOOL,
  description:
    "收队：等本批子 agent 到终态并一次拿回它们的状态/摘要/用量。派生过 worker 后必须先调用它再下结论——" +
    "worker 看不到本会话历史，也没人替你把它们的产出读进上下文。",
  parameters: {
    type: "object",
    properties: {
      agent_ids: { type: "array", items: { type: "string" }, description: "缺省 = 本会话全部 worker" },
      timeout_ms: { type: "number", description: "等待上限 ms（缺省 120000，超上限会被钳制并如实报出）" },
    },
  },
} as const;
```

- [ ] **Step 4：跑到绿** — 最后一条规格测此时仍会红（`gateToolSpecs` 里还没加规格）⇒ **正确红**，Task 4 修。把这条测留在原地，它就是 Task 4 的验收判据。

---

## Task 4: 两头接线（模型可见规格 + 可执行实例）

**Files:**
- Modify: `src/agent/glm-session.ts`「gateToolSpecs」——追加规格对象 + 只读档摘除条件
- Modify: `src/main/agent-runner.ts`「installAppTools」——紧邻 `spawn_agent` 注入实例
- Modify: `src/agent/orchestrator.ts`——补 `hasWorkers()`（两行，工具体依赖它）
- Test: 复用 `tests/wait-for-agents-tool.test.ts`（不新增文件）+ 追加到既有只读档断言面 `tests/session-tools.test.ts` 的同一口径

**Interfaces:**
- Consumes: Task 3 的 `waitForAgentsSpec` / `createWaitForAgentsTool`、类方法 `waitForAgents` / `workerIds`
- Produces: 模型在 `default`/`auto` 档看到 `wait_for_agents`、`read-only` 档看不到；`TOOLS[wait_for_agents]` 可执行

- [ ] **Step 1：先跑到红**（Task 3 末已红，无需重写命令）

- [ ] **Step 2：加规格** — `src/agent/glm-session.ts`，紧接既有 `spawn_agent` 规格对象之后

```ts
    // W1a 收队原语：与 spawn_agent 同族——「派得出去、收不回来」正是本仓第 5 次复发的
    // 「能力已发货、产品路径绕过它」缺陷族（join 原语只有验收脚本在调）。
    // 规格面与实例面必须同笔落地，tests/tool-surface-parity.test.ts（Task 5）钉这条。
    {
      type: "function",
      function: {
        name: "wait_for_agents",
        description:
          "收队：等本批子 agent 到终态并一次拿回状态/摘要/用量。派生过 worker 后先调它再下结论；" +
          "缺省等全部，可给 agent_ids 只等其中几个。",
        parameters: obj(
          {
            agent_ids: { type: "array", items: { type: "string" }, description: "缺省 = 本会话全部 worker" },
            timeout_ms: { type: "number", description: "等待上限 ms（缺省 120000）" },
          },
          [],
        ),
      },
    },
```

同文件末尾的只读档过滤行改成：

```ts
  if (mode === "read-only") {
    // 只读档连同编排原语一并摘除：spawn_agent 靠 SIDE_EFFECT_TOOLS，wait_for_agents 不是写向工具
    // （不该被方案门挡），所以只能显式点名——漏摘就是「模型看得见、执行面白名单挡着」那类两头断。
    return specs.filter((s) => !isSideEffectTool(s.function.name) && s.function.name !== "remember" && s.function.name !== "wait_for_agents");
  }
```

- [ ] **Step 3：加实例** — `src/main/agent-runner.ts`「installAppTools」内，紧接 `spawn_agent` 注入块之后

```ts
  // W1a：收队工具（与 spawn_agent 同一注入面、同一「编排器未接线即 fail-closed」口径）。
  // 走 currentOrchestrator() 而不是直接读 activeOrchestrator：H3-P3 的 RunScope 并发隔离靠它，
  // 绕过去会让并发的 unattended run 抢到交互面的编排器（那是 D-2 立项专门修掉的洞）。
  (TOOLS as unknown as Record<string, Tool>).wait_for_agents = createWaitForAgentsTool(() => currentOrchestrator());
```

`import` 区追加：

```ts
import { createWaitForAgentsTool } from "../tools/wait_for_agents";
```

- [ ] **Step 4：补 `hasWorkers()`** — `src/agent/orchestrator.ts`，紧接既有 `workerIds()`：

```ts
  /** 收队工具的短路判据：一个 worker 都没有就别建等待项（零行为，省一次模型可见的空 payload）。 */
  hasWorkers(): boolean {
    return this.workers.size > 0;
  }
```

- [ ] **Step 5：跑到绿 + 全量单测**

```bash
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/wait-for-agents-tool.test.ts
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/session-tools.test.ts tests/agents.test.ts tests/glm-session.test.ts
```
期望：全绿。若 `agents.test.ts` / `glm-tools` 类文件里有「规格表条数」的计数断言 ⇒ 那是本次新增规格的**预期红**，按 AGENTS.md 判卷纪律处理：**只调整计数常量本身并在提交信息里点名原因**，不改被测代码、不删断言。先 `grep -n "toHaveLength\|gateToolSpecs" tests/*.ts | head` 把撞面找全再动。

- [ ] **Step 6：提交**

```bash
git add src/agent/glm-session.ts src/main/agent-runner.ts src/agent/orchestrator.ts tests/wait-for-agents-tool.test.ts
git commit -m "wait_for_agents 两头接线：规格进 gateToolSpecs（只读档随编排原语一并摘除）、实例进 installAppTools 走 RunScope 口径"
```

---

## Task 5: G-B 三处同源静态对账门

**Files:**
- Create: `src/agent/tool-surface.ts`
- Create: `tests/tool-surface-parity.test.ts`

**Interfaces:**
- Consumes: `gateToolSpecs(mode)`（规格面，真函数调用）、`workerToolSpecs(mode, opts)` / `workerToolTable(mode, bool)`（worker 两面，真函数调用）、`src/main/agent-runner.ts` 与 `src/agent/glm-session.ts` 的**源文本**（实例面与注入点）
- Produces: `INJECTED_TOOLS: readonly InjectedToolSurface[]`（生产与测试共读的一份声明表；W3/W4 后续新工具进这张表）

为什么实例面走源文本而不是执行 `installAppTools()`：那个函数会拉起 AskGate / 调度器 / electron 依赖，在单测里调用它等于起半个主进程。文本对账换一点精度换来「在 `test` 门里跑得起」，且它的失效方向是**假绿**，所以必须配一条反向对照（Step 1 的最后一条测）。

- [ ] **Step 1：写失败测试** — `tests/tool-surface-parity.test.ts`

```ts
// G-B：运行时注入工具的「三面」对账（spec §2 不变量 1 / §7 G-B）。
// 本仓已 5 次栽在同一形态上（spawn_agent、lsp、impact_query 的 worker 三处、worker 写端回注），
// 靠变异锚点守太贵——每条能力都要人记得加。这里换成静态对账：一张声明表 + 三面实测。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INJECTED_TOOLS, missingFromFace, type InjectedToolSurface } from "../src/agent/tool-surface";
import { gateToolSpecs } from "../src/agent/glm-session";
import { workerToolSpecs } from "../src/agent/worker-shell-tools";   // 定义在这，不在 glm-session
import { workerToolTable } from "../src/agent/orchestrator-config";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = readFileSync(join(ROOT, "src/main/agent-runner.ts"), "utf8");

/** 实例面两种形态都要认：① installAppTools 直接写全局 TOOLS；② runLoop 的 tools 覆盖（按开关注入）。 */
function instanceNames(): Set<string> {
  const out = new Set<string>();
  for (const m of RUNNER.matchAll(/TOOLS as unknown as Record<string, Tool>\)\.([a-z_][a-z0-9_]*)\s*=/g)) out.add(m[1]!);
  for (const m of RUNNER.matchAll(/\b([a-z_][a-z0-9_]*)\s*:\s*(?:recall|impactTool|createImpactQueryTool\()/g)) out.add(m[1]!);
  return out;
}
/** 两个面返回形状不同（主会话 {function:{name}}、worker 同形），统一按名字收。 */
const namesOf = (specs: readonly { function?: { name: string }; name?: string }[]): Set<string> =>
  new Set(specs.map((s) => s.function?.name ?? s.name ?? ""));

const mainSpecs = (): Set<string> => namesOf(gateToolSpecs("auto"));
const workerSpecs = (mode: "read" | "write"): Set<string> => namesOf(workerToolSpecs(mode, { impactAnalysis: true }));

function report(surface: InjectedToolSurface): string[] {
  const problems: string[] = [];
  const instances = instanceNames();
  if (surface.specFace === "static" && !mainSpecs().has(surface.name)) {
    problems.push(`规格面缺 ${surface.name}（模型看不见 = 发不出去）`);
  }
  if (!instances.has(surface.name)) problems.push(`实例面缺 ${surface.name}（模型发得出，但没人执行）`);
  const modes: ("read" | "write")[] =
    surface.workerReachable === "both" ? ["read", "write"]
      : surface.workerReachable === false ? []
        : [surface.workerReachable];
  for (const mode of modes) {
    if (!workerSpecs(mode).has(surface.name)) problems.push(`worker(${mode}) 规格面缺 ${surface.name}`);
    if (!workerToolTable(mode, true).includes(surface.name)) problems.push(`worker(${mode}) 白名单缺 ${surface.name}`);
  }
  if (surface.workerReachable === false) {
    for (const mode of ["read", "write"] as const) {
      // 反向：标了不可达却进了白名单 ⇒ 「worker 权限 ≤ 父会话」那三道硬闸形同虚设
      if (workerToolTable(mode, true).includes(surface.name)) problems.push(`${surface.name} 标了 worker 不可达，却在 worker(${mode}) 白名单里`);
    }
  }
  // 写向判定与 permissions 的真值对账：漏登 SIDE_EFFECT_TOOLS 会让只读档/方案门静默失效
  if (isSideEffectTool(surface.name) !== surface.mainSessionSideEffect) {
    problems.push(`${surface.name} 的写向判定漂移（表 ${String(surface.mainSessionSideEffect)} vs permissions ${String(isSideEffectTool(surface.name))}）`);
  }
  return problems;
}

describe("G-B 注入工具三面对账", () => {
  it("每个声明项在应有的一面全部在场（缺哪面报哪面，不整体红）", () => {
    const bad = INJECTED_TOOLS.flatMap((s) => report(s).map((p) => s.name + " :: " + p));
    expect(bad).toEqual([]);
  });

  it("只读档的摘除面与声明一致（只查静态表：运行期注入项由各自的开关管）", () => {
    for (const s of INJECTED_TOOLS.filter((x) => x.specFace === "static")) {
      expect(gateToolSpecs("read-only").some((t) => t.function.name === s.name)).toBe(s.reachableWhenReadOnly);
    }
  });

  it("声明表本身不可漏项：源文本里出现的注入名必须登记（不登记 = 新工具绕过这道门）", () => {
    const declared = new Set(INJECTED_TOOLS.map((s) => s.name));
    const injectedInSource = [...RUNNER.matchAll(/TOOLS as unknown as Record<string, Tool>\)\.([a-z_][a-z0-9_]*)\s*=/g)].map((m) => m[1]!);
    expect(injectedInSource.filter((n) => !declared.has(n))).toEqual([]);
  });

  it("对账本身有分辨力（反向对照：没这条的静态门等于没立）", () => {
    expect(missingFromFace(["real_tool", "ghost_tool"], new Set(["real_tool"]))).toEqual(["ghost_tool"]);
    const fake: InjectedToolSurface = {
      name: "ghost_tool", specFace: "static", workerReachable: "both", reachableWhenReadOnly: false, mainSessionSideEffect: false,
    };
    expect(report(fake).length).toBeGreaterThanOrEqual(4);   // 主规格面 + 实例面 + worker 两面，一处不漏
  });
});
```

`import` 区还需要（`isSideEffectTool` 由 `src/permissions` 出口提供，与 `glm-session` 同一取法）：

```ts
import { isSideEffectTool } from "../src/permissions";
```

- [ ] **Step 2：跑到红**（`tool-surface` 模块不存在）

- [ ] **Step 3：写声明表** — `src/agent/tool-surface.ts`

```ts
// 运行时注入工具的**唯一清单**：生产与 G-B 对账共读这一份（测试里再抄一张 = 第二个事实源）。
// 进这张表的条件：该工具不在 src/tools/index.ts 的静态 9 工具注册表里，而是在运行期挂上模型面。
// 注：插件 skill 与 MCP scoped 工具是动态名，由 plugins-check 按「规格与可执行面同集合」判，不在此表。
// 每个字段都必须被 report() 读到——没有消费者的字段就是这张表自己的死码（本仓最忌「机器齐全两头断」）。

export interface InjectedToolSurface {
  name: string;
  /** 规格从哪一面来：`static` = glm-session 的 gateToolSpecs 静态表（常驻原语），
   *  `runtime` = 运行期按开关注入（obs_recall / impact_query / MCP / skill）。
   *  没有这个字段，静态门会去静态表里找只在运行期出现的工具 ⇒ 假红，然后被人调成假绿。 */
  specFace: "static" | "runtime";
  /** worker 哪一档够得着（`remember` 只在 write 面出现——粗粒度布尔会把 read 面判成假红） */
  workerReachable: "both" | "read" | "write" | false;
  /** 只读档（sidechat / read-only 会话）模型面是否应出现。仅对 specFace=static 有判据可查。 */
  reachableWhenReadOnly: boolean;
  /** 是否被 SIDE_EFFECT_TOOLS 计入写向（决定它受不受方案门挡）；与 permissions 的真值对账 */
  mainSessionSideEffect: boolean;
}

export const INJECTED_TOOLS: readonly InjectedToolSurface[] = [
  { name: "spawn_agent", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: true },
  { name: "wait_for_agents", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  { name: "remember", specFace: "static", workerReachable: "write", reachableWhenReadOnly: false, mainSessionSideEffect: false },
  // impact_query 的 worker 三处同源已有 3 条变异锚点守着，登记进表 = 再多一道静态兜底
  { name: "impact_query", specFace: "runtime", workerReachable: "both", reachableWhenReadOnly: true, mainSessionSideEffect: false },
];
// verify **不入表**：它不在 TOOLS 里，由 runLoop 当系统门特判（tools/index.ts 头注写明）。
// 把一个非工具塞进工具对账门，得到的只会是一条必须被豁免的假红。

/** 「缺谁」的单一实现——反向对照也走它，保证判据本身被测过。 */
export function missingFromFace(names: readonly string[], face: ReadonlySet<string>): string[] {
  return names.filter((n) => !face.has(n));
}
```

⚠️ **`remember` / `verify` / `impact_query` 三条的预期值以实测为准**：Step 4 若某条红，先读那三个面的真实行为再改**表**——**只有确认「表写错」才改表，若揭示的是真缺陷（某一面确实缺），停手回 spec 立案**，别把静态门调成刚好通过。这是本任务最容易走歪的地方。

- [ ] **Step 4：跑到绿 + 全量**

```bash
TERM=dumb node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/tool-surface-parity.test.ts
pnpm typecheck
```

- [ ] **Step 5：提交**

```bash
git add src/agent/tool-surface.ts tests/tool-surface-parity.test.ts
git commit -m "G-B 三处同源静态门：注入工具声明表 + 规格/实例/worker 白名单对账（含门自身的反向对照）"
```

---

## Task 6: 变异锚点、spec 口径更正、全量收口

**Files:**
- Modify: `scripts/mutate-verify.mjs`（`const MUTATIONS = [` 表尾追加 8 条，**动手前重读尾部十几行**——该表在并发下几十秒内就会被别人追加，行号会漂）
- Modify: `docs/superpowers/specs/2026-09-19-orchestration-design.md`（追加更正节，不改写原文）

- [ ] **Step 1：取表尾插入点**

```bash
grep -n "^const MUTATIONS\|^];" scripts/mutate-verify.mjs | head -3
```

- [ ] **Step 2：追加 8 条锚点**（`apply` 的替换串必须**逐字**来自当前源文件，缩进以 `Read` 结果为准——`.replace` 静默不命中是本仓实测坑）

```js
  {
    id: "join-row-cap-not-counted",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/orchestrator-join.test.ts",
    desc: "逐行帽不计入截断提示 ⇒ 「≤400 token」变成「400 + 提示」，承诺被提示自己撑破（SHELL_NOTICE_RESERVE 同族坑）",
    apply: (s) => s.replace("const clipped = clipWorkerSummary(input.report, WAIT_ROW_TOKEN_CAP);", "const clipped = { text: input.report, truncated: false };"),
    expectFail: "单行超帽 ⇒ 截断且提示计入预算（总长仍 ≤ 帽，不是「帽 + 提示」）",
  },
  {
    id: "join-batch-cap-dropped",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/orchestrator-join.test.ts",
    desc: "取消整批帽 ⇒ 4×400 仍能塞穿父上下文（数量有界 ≠ 体积有界）",
    apply: (s) => s.replace("const fits = used + cost <= WAIT_BATCH_TOKEN_CAP;", "const fits = true;"),
    expectFail: "整批超帽 ⇒ 后段降级为一行状态并登记 degraded（数量有界 ≠ 体积有界）",
  },
  {
    id: "join-degraded-row-vanishes",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/orchestrator-join.test.ts",
    desc: "被降级的行整条消失 ⇒ 模型只能以为那个 worker 白跑",
    apply: (s) => s.replace(
      "      rows.push({ agent_id: input.agentId, status: input.status, task: input.task, summary: \"\", truncated: false, usage: input.usage });\n      continue;",
      "      continue;"),
    expectFail: "整批超帽 ⇒ 后段降级为一行状态并登记 degraded（数量有界 ≠ 体积有界）",
  },
  {
    id: "join-timeout-silently-defaults",
    src: "src/agent/orchestrator-join.ts",
    test: "tests/orchestrator-join.test.ts",
    desc: "非法 timeout 静默回落缺省 ⇒ 模型以为自己设了 10 分钟、实际等了 2 分钟（fail-visible 反例）",
    apply: (s) => s.replace("    return { ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false, rejected: \"timeout_ms 必须是数字\" };", "    return { ms: WAIT_TIMEOUT_DEFAULT_MS, clamped: false };"),
    expectFail: "超时：缺省用默认值；过大钳到硬帽并如实报钳制；非数一律 fail-visible 拒绝",
  },
  {
    id: "wait-unknown-id-enters-waiters",
    src: "src/agent/orchestrator.ts",
    test: "tests/orchestrator-wait.test.ts",
    desc: "未知 id 不先摘 ⇒ 进 terminalWaiters 永不触发：这次等待永挂 + 等待项泄漏（waitForAgentTerminal 的原语行为，不是本方法的错）",
    apply: (s) => s.replace("    const known = targets.filter((id) => this.workers.has(id));", "    const known = [...targets];"),
    expectFail: "未知 id fail-visible 摘出（喂进 waitForAgentTerminal 会永挂 + 泄漏等待项）",
  },
  {
    id: "wait-abort-kills-workers",
    src: "src/agent/orchestrator.ts",
    test: "tests/orchestrator-wait.test.ts",
    desc: "取消信号越权：收队方 abort 时顺手 abort 全部 worker ⇒ 一次超时等待变成把团队的活杀了",
    apply: (s) => s.replace("      if (onAbort !== undefined && signal !== undefined) signal.removeEventListener(\"abort\", onAbort);", "      if (onAbort !== undefined && signal !== undefined) signal.removeEventListener(\"abort\", onAbort);\n      if (signal?.aborted) this.cancelAll();"),
    expectFail: "取消信号 ⇒ 立即收束并标 cancelled（不等满 timeout）",
  },
  {
    id: "wait-tool-blind-to-no-orchestrator",
    src: "src/tools/wait_for_agents.ts",
    test: "tests/wait-for-agents-tool.test.ts",
    desc: "编排器未接线时返回空结果而非拒绝 ⇒ 模型读到「没有任何 worker」的假象",
    apply: (s) => s.replace("      if (!orch) return { ok: false, output: \"wait_for_agents: 编排器未接线（fail-closed）\" };", "      if (!orch) return { ok: true, output: \"[join] 本会话没有 worker——无需收队，直接继续。\" };"),
    expectFail: "编排器未接线 ⇒ fail-closed 拒绝（与 spawn_agent 同一措辞族，不静默返回空）",
  },
  {
    id: "gb-parity-face-blind",
    src: "src/agent/tool-surface.ts",
    test: "tests/tool-surface-parity.test.ts",
    desc: "对账函数恒返回空 ⇒ 静态门变成盖章机器（本仓最忌的假绿形态）",
    apply: (s) => s.replace("  return names.filter((n) => !face.has(n));", "  return [];"),
    expectFail: "对账本身有分辨力（反向对照：没这条的静态门等于没立）",
  },
```

- [ ] **Step 3：逐条实测「必杀」**（前 7 条的 `expectFail` 与被测用例标题必须**逐字一致**，否则报「红了但没红在期望用例上」是假失败）

```bash
TERM=dumb node --import tsx scripts/mutate-verify.mjs join-row-cap-not-counted join-batch-cap-dropped join-degraded-row-vanishes join-timeout-silently-defaults wait-unknown-id-enters-waiters wait-abort-kills-workers wait-tool-blind-to-no-orchestrator gb-parity-face-blind 2>&1 | tail -20
echo "exit=$?"
```
期望：`全部杀掉`，exit=0。判绿读它自己打印的汇总行，不读管道尾的退出码。

- [ ] **Step 4：spec 追加口径更正**（原文一字不改，历史不覆写）

在 `docs/superpowers/specs/2026-09-19-orchestration-design.md` 文件**末尾**追加：

```markdown
---

## 11. 执行期更正（2026-09-19 同日两笔，本人下笔处，不改写上文）

1. §2 不变量 3 与 §5 W3 里「中文段帽一律以字符登记」的前提**已失效**：`d98fa19` 把
   `estimateTextTokens` 改成按字符类别计量（CJK 一字一 token），`4f66015` 又把 worker 报告裁剪接到同一口径。
   ⇒ 帽可以直接按 token 写，W3 的「系统提示段」预算改用同一量纲，不再需要「字符帽」这条 workaround。
   上文那段作为当日真值保留。
2. §3 W1a 的返回体里 `cost_usd` **移出 W1a**：会话级估价只有 `budgetEstimateUsd()` 一条现成通道，
   逐 worker 折算要新铺一条 pricing 路径 = 第二事实源。钱随 §5 W3「spawn 回执与终态结果带累计账」
   一起做，那里本就要接 `metering/pricing`。W1a 只回 `usage`。
```

- [ ] **Step 5：全量收口 + 提交**

```bash
pnpm typecheck && TERM=dumb pnpm gates 2>&1 | tail -40; echo "gates-exit=$?"
git add scripts/mutate-verify.mjs docs/superpowers/specs/2026-09-19-orchestration-design.md
git commit -m "变异表 +8：收队三段帽 / 未知 id 摘除 / abort 越权 / 工具 fail-closed / 静态门分辨力，八条实测全杀"
```

`pnpm gates` 的两条判读法（都实测踩过，别当回归改代码）：
- 唯一红是 `mutate-verify` 且它点名的是**别人的在飞文件** ⇒ 正确红，标注「对方一提交即转绿」。
- `panels-check` 报 CDP 超时 / DOM 0 节点 / 徽标时延 ⇒ 先单跑 `pnpm run panels-check` 复验，连续两三次红同一批断言才算真问题（本轮改动**不触渲染层**，这是刻意的零交集，见 Global Constraints 第 2 条）。

---

## Self-Review（写完后自查，逐条已核）

1. **spec 覆盖**：spec §3 W1a（接口 / 语义 / 复用 / 返回体 / 零新事件 / 测 + 4 锚点）→ Task 1–4 全覆盖，锚点实际给了 8 条（比 spec 多 4，因为纯函数面三条各有独立失效方向）；spec §7 G-B → Task 5 + `gb-parity-face-blind` 锚点。spec §3 W1b、§4 W2、§5 W3、§6 W4 **不在本计划范围**（本计划只管 W1a + G-B，符合用户点名）。
2. **占位扫描**：无 TBD / 「适当错误处理」 / 「同 Task N」。两处标注为「以实测为准」的地方（Task 4 Step 5 的规格计数断言、Task 5 Step 3 的声明表预期值）不是占位，而是**必须现场核对的既有判据**，且各自写明了「只有确认表/常量写错才改，否则回 spec 立案」的处置规则。
3. **类型一致性**：`JoinInput` / `JoinRow` / `JoinPayloadBody` / `WaitTimeout` 由 Task 1 定义，Task 2 生产 `JoinPayloadBody`、Task 3 消费 `renderJoinPayload(JoinPayloadBody)`；`waitForAgents(ids, timeoutMs, signal?)` 三处签名一致；`hasWorkers()` 在 Task 3 的接口里声明为必需、Task 4 Step 4 才在类里落地——这是**刻意的顺序**（Task 3 测用结构桩，不因此红）。
4. **与并发会话的冲突面**：本计划 12 个文件里，与当前在飞改动集（`src/renderer/**`、`scripts/renderer-arch-check.ts`、两个 renderer 测试）**零交集**。`src/agent/*` 正被另一会话以分钟级速度提交（写这份计划期间 HEAD 又前进了 4 笔：`d98fa19` `4f66015` `4ff7ca8` `e4f562e`）⇒ 每个 Step 0 的 `git diff HEAD --` 是硬前置，不是仪式。

**本次自查现场改掉的四条错（都是"看起来对、跑起来红"的那类，记下来省下一轮返工）**：
① Task 2 的测试原本断言 `usage.outputTokens > 0`，但 `w.usage` 只由子流 `usage` 事件累加 ⇒ 脚本化剧本不给 usage 事件就会测出 0；改成剧本显式给 `5/7` 并断言等值。
② Task 3 的 `hostWith` 桩原本用 `calls.length === 0` 推 `hasWorkers` ⇒ 第一次调用就返回 false，正常收队那条测必然红；拆成 `hasWorkers: () => true` 与独立的 `emptyHost()`。
③ Task 5 原本从 `glm-session` 导 `workerToolSpecs` 与 `GlmToolSpec`——前者实际定义在 `src/agent/worker-shell-tools.ts`，后者在 `src/providers/glm.ts`；同时把 `verify` 从声明表里摘掉（它不是 TOOLS 里的工具，是 runLoop 特判的系统门，留在表里只会产生一条必须豁免的假红），并把 `workerReachable` 从布尔改成 `"both"|"read"|"write"|false`（`remember` 只在 write 面，粗粒度布尔会把 read 面判成假红）。
④ Task 5 新增 `specFace` 字段：不区分静态/运行期规格面，静态门会去 `gateToolSpecs` 里找 `impact_query`（它只由开关注入）⇒ 假红。四个字段现在都被 `report()` 或某条测读到，没有一项是"声明了没人查"的装饰。
