# m0 桌面端 M2：驾驶舱主区完整化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 驾驶舱主区从 v0.1 静态切片升到 spec §11 M2 完整形态：`ts` 时间戳真值落盘、delta 流式与运行态动效、模型选择器、tokens 面板、审批 scope 展开＋澄清卡＋方案卡、composer 运行中禁用，并以"审批→执行→打断"全链路 headless 判卷收口。

**Architecture:** `ts` 是 spec §3.5 承诺的**唯一 core 增量**：`createEventLog` 加可选 `timestamps` 开关（缺省关＝字节级现状），经 `RunOverrides.eventTimestamps` 从 kernel-host 一路打开；其余全部活在 `apps/desktop/`（投影纯函数升级 + 组件）。判卷红线：缺省路径零行为变化、冻结判卷文件与夹具不碰。

**Tech Stack:** 同 M1（Electron 38 / React 18 / Vite 7 / vitest 双 config）。

**Spec:** `docs/superpowers/specs/2026-10-02-desktop-shell-design.md`（§3.5 ts 增量、§6.1 token、§6.2/6.3 交互规格、§11 M2 行）

## Global Constraints

- core 改动面**白名单**（除此之外 `src/` 零改动，`git diff -- src/` 只允许出现这几个文件）：`src/events/index.ts`（createEventLog 签名＋AgentEvent 别名交集）、`src/main/agent-runner.ts`（RunOverrides/RunOptions 透传＋:1634 调用点）。
- `ts` 语义：缺省**关**（不写该字段，落盘字节与现状逐字一致）；开 = append 时写 `ts: Date.now()`（毫秒数）。旧日志无 `ts`，重放/投影必须容忍（显示留空，不造假）。
- 冻结判卷文件与夹具不碰；根门保持绿（已知存量红 cli-surface 归并行会话，形状一致即合规）；根 vitest 不扫 apps/。
- 桌面测试：`pnpm --filter m0-desktop test`；构建：`pnpm --filter m0-desktop build`；冒烟：`M0_SMOKE=1 M0_DESKTOP_WORKSPACE=$(mktemp -d) pnpm --filter m0-desktop exec electron .`。
- 并行会话脏文件不碰不 add：scripts/docs-check.ts、scripts/head-cert*、scripts/mutate-verify.mjs、outputs/、.vitest/。
- 视觉 token 用 spec §6.1 既有 CSS 变量，不新加颜色；彩色只留风险/错误/diff。
- 提交只 add 本任务清单内文件，提交信息中文详述（仓库惯例）。

---

### Task 1: `ts` 增量（唯一 core 改动）

**Files:**
- Modify: `src/events/index.ts`（:557 `AgentEvent` 别名；:736 `createEventLog`）
- Modify: `src/main/agent-runner.ts`（:1987 `RunOverrides`；runAgent 的 opts 类型与 :1634 调用点；handleAgentRun 组装处 :2102-2143 一带）
- Modify: `apps/desktop/src/main/kernel-host.ts`（run 透传）
- Test: `tests/event-log-timestamps.test.ts`（根仓 vitest）

**Interfaces:**
- Produces:
  - `createEventLog(path: string, opts?: { timestamps?: boolean }): EventLog` — `timestamps: true` 时每次 append 给事件写 `ts: Date.now()` 再落盘；
  - `AgentEvent` 别名变为联合与 `{ ts?: number }` 的交集（读侧到处可见可选 `ts`，写侧不受影响）；
  - `RunOverrides.eventTimestamps?: boolean` → runAgent opts 同名透传 → :1634 创建日志时开启。
  - kernel-host `run()` 恒以 `eventTimestamps: true` 调 `handleAgentRun`。

- [ ] **Step 1: 写根仓失败测试**

`tests/event-log-timestamps.test.ts`：

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEventLog, replay } from "../src/events";

const dir = () => mkdtempSync(join(tmpdir(), "m0-evtlog-"));
const ev = { type: "user_message", content: "你好" } as const;

describe("createEventLog timestamps 开关", () => {
  it("缺省关：落盘字节与事件本面逐字一致（无 ts 字段）", async () => {
    const p = join(dir(), "a.jsonl");
    await createEventLog(p).append({ ...ev });
    const line = readFileSync(p, "utf8").trim();
    expect(JSON.parse(line)).not.toHaveProperty("ts");
  });
  it("开启后：每行带毫秒 ts，且两次 append 的 ts 不减", async () => {
    const p = join(dir(), "b.jsonl");
    const log = createEventLog(p, { timestamps: true });
    await log.append({ ...ev });
    await log.append({ ...ev });
    const lines = readFileSync(p, "utf8").trim().split("\n");
    const t1 = JSON.parse(lines[0]!).ts as number;
    const t2 = JSON.parse(lines[1]!).ts as number;
    expect(Number.isFinite(t1)).toBe(true);
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
  it("重放兼容双向：无 ts 旧日志照常重放；带 ts 新日志保真回读", async () => {
    const old = join(dir(), "old.jsonl");
    await createEventLog(old).append({ ...ev });
    const oldEvents = await replay(old);
    expect(oldEvents).toHaveLength(1);
    expect((oldEvents[0] as { ts?: number }).ts).toBeUndefined();

    const neu = join(dir(), "new.jsonl");
    await createEventLog(neu, { timestamps: true }).append({ ...ev });
    const newEvents = await replay(neu);
    expect(typeof (newEvents[0] as { ts?: number }).ts).toBe("number");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/event-log-timestamps.test.ts`
Expected: FAIL（createEventLog 不接受第二参 / ts 断言失败）。

- [ ] **Step 3: 实现三处（白名单内）**

`src/events/index.ts` :557 一带——别名加交集（保持成员不变）：

```ts
export type AgentEvent = (/* 原联合逐字不动 */ ...成员...) & { /** M2 §3.5：事件真值时间戳（毫秒）；缺省关，旧日志缺席。 */ ts?: number };
```

:736 一带——签名与 append：

```ts
export function createEventLog(path: string, opts?: { timestamps?: boolean }): EventLog {
  const stamp = opts?.timestamps === true;
  // ...原实现逐字保留...
  async append(event) {
    const outgoing = stamp ? ({ ts: Date.now(), ...event } as typeof event) : event;
    // ...原写入逻辑，写 outgoing 不写 event...
```

注意：`ts` 放在展开的**前面**还是后面不影响语义，但落盘键序要稳定——用 `{ ts: Date.now(), ...event }` 会让 ts 在前；若事件自身带 ts（重放回写场景）以事件自身为准（展开覆盖）。选哪种都行，测试断言的是字段存在与数值，不是键序。

`src/main/agent-runner.ts`——三处：①`RunOverrides`（:1987）加一行 `/** M2 §3.5：桌面端打开事件真值时间戳（缺省关＝CLI 字节级现状）。 */ eventTimestamps?: boolean;`；②runAgent 的 opts 类型加同名可选字段并在 :1634 改 `log = createEventLog(opts.logPath, opts.eventTimestamps ? { timestamps: true } : undefined);`；③handleAgentRun 组装 runAgent 调用处（:2102 一带的 `runAgent({...})`）加 `...(over.eventTimestamps ? { eventTimestamps: true as const } : {})`。

`apps/desktop/src/main/kernel-host.ts`——`run: (req) => handleAgentRun(req, { eventTimestamps: true })`。

- [ ] **Step 4: 全量门**

Run: `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts`（根门形状与 M1 终审一致：唯一存量红 cli-surface）＋ `pnpm --filter m0-desktop test` ＋ `pnpm typecheck`
Expected: 新测试 3 例绿；根门其余形状不变（缺省关保证）。

- [ ] **Step 5: Commit**

```bash
git add src/events/index.ts src/main/agent-runner.ts apps/desktop/src/main/kernel-host.ts tests/event-log-timestamps.test.ts
git commit -m "桌面端 M2-1：事件真值时间戳（spec §3.5 唯一 core 增量）——createEventLog 可选 timestamps 开关（缺省关＝字节级现状，判卷零扰）、AgentEvent 别名加可选 ts 交集、RunOverrides.eventTimestamps 经 runAgent 透传到 :1634 创建点；kernel-host 恒开；三例判卷（缺省无 ts／开启毫秒不减／旧日志重放兼容）"
```

---

### Task 2: 投影 v2（时间戳/delta 流式/工具待定态/phase 修正/三卡选择器）

**Files:**
- Modify: `apps/desktop/src/renderer/projections.ts`（整体升级）
- Test: `apps/desktop/tests/projections.test.ts`（扩展）

**Interfaces:**
- Produces（后续任务消费的唯一投影面）:

```ts
export type StreamRow =
  | { kind: "user"; text: string; ts?: number; seq: number }
  | { kind: "assistant"; text: string; live?: boolean; ts?: number; seq: number }   // live=delta 流式中的行
  | { kind: "tool"; tool: string; summary: string; pending?: boolean; ok?: boolean; ts?: number; seq: number }
  | { kind: "error"; text: string; ts?: number; seq: number };

export type RunPhase = "idle" | "thinking" | "tool" | "ask" | "clarify" | "plan";

export function projectStream(events: readonly AgentEvent[]): StreamRow[];
export function deriveRunPhase(events: readonly AgentEvent[], pendingAsk: boolean, pendingClarify: boolean, pendingPlan: boolean): RunPhase;
export function pendingClarifyOf(events: readonly AgentEvent[]): { callId: string; questions: ClarifyQuestion[] } | null;
export function pendingPlanOf(events: readonly AgentEvent[]): { callId: string; plan: PlanProposal } | null;
export function usageAggregate(events: readonly AgentEvent[]): { inputTokens: number; outputTokens: number; usageCount: number };
export function relativeTime(nowMs: number, tsMs: number): string; // "刚刚"|"N 分钟前"|"N 小时前"|"N 天前"|YYYY-MM-DD
```

语义钉死：
- **delta 聚合**：`assistant_delta` 按 `callId` 分桶累计；桶在 `assistant_message` 到达时被其终稿行取代（终稿行 live=false）。桶未结时输出 live=true 的 assistant 行（text=该桶累计）。
- **工具待定**：`tool_call` 行 `pending=true`，直到出现 `tool_result.callId === tool_call.id` ⇒ `pending=false, ok=result.ok`。`tool_result` 无匹配 callId 时忽略（不造假行）。
- **phase**：尾扫改判据——最后一个未决 `tool_call`（无对应 result）⇒ "tool"；`assistant_delta` 晚于最后 tool_result ⇒ "thinking"；error 在尾部 ⇒ "idle"（error 行自呈现）；三 pending 参数任一 true ⇒ 对应 "ask"/"clarify"/"plan"（ask 优先级最高）。
- **pendingClarify**：最后一个 `clarify_requested`，且其后无 `callId` 相同的 `tool_result`；**pendingPlan**：最后一个 `plan_proposed`，且其后无同 `callId` 的 `plan_approved`。
- **usageAggregate**：累加全部 `usage` 事件（`inputTokens`/`outputTokens`），缺字段当 0（UsageEvent 字段必在，防御旧日志）。
- **relativeTime**：<60s "刚刚"；<60m "N 分钟前"；<24h "N 小时前"；<7d "N 天前"；否则本地日期 `YYYY-MM-DD`。

- [ ] **Step 1: 扩投影失败测试**（`apps/desktop/tests/projections.test.ts` 追加；保留 M1 既有用例并把 `tool` 行断言按新形状补 `pending`/`ok`）

```ts
describe("投影 v2", () => {
  it("delta 流式：未结桶输出 live assistant 行，assistant_message 终稿取代", () => {
    const rows = projectStream([
      ev({ type: "assistant_delta", callId: "c1", text: "你" }),
      ev({ type: "assistant_delta", callId: "c1", text: "好" }),
    ]);
    expect(rows).toEqual([expect.objectContaining({ kind: "assistant", text: "你好", live: true })]);
    const done = projectStream([
      ev({ type: "assistant_delta", callId: "c1", text: "你" }),
      ev({ type: "assistant_message", content: "你好" }),
    ]);
    expect(done).toEqual([expect.objectContaining({ kind: "assistant", text: "你好", live: false })]);
  });
  it("工具待定：tool_call 未决 pending，tool_result 按 callId 收口 ok", () => {
    const rows = projectStream([
      ev({ type: "tool_call", id: "t1", name: "run_shell", args: { command: "pnpm bench" } }),
    ]);
    expect(rows[0]).toMatchObject({ kind: "tool", tool: "run_shell", pending: true });
    const closed = projectStream([
      ev({ type: "tool_call", id: "t1", name: "run_shell", args: {} }),
      ev({ type: "tool_result", callId: "t1", ok: true, output: "done" }),
    ]);
    expect(closed[0]).toMatchObject({ kind: "tool", pending: false, ok: true });
  });
  it("时间戳：事件 ts 透传到行；无 ts 留空", () => {
    const rows = projectStream([ev({ type: "user_message", content: "hi", ts: 1727848800000 })]);
    expect(rows[0]).toMatchObject({ ts: 1727848800000 });
    expect(projectStream([ev({ type: "user_message", content: "hi" })])[0]!.ts).toBeUndefined();
  });
  it("pendingClarify/Plan：请求未决给出，tool_result/plan_approved 收口", () => {
    const c = { type: "clarify_requested", callId: "q1", questions: [{ question: "选哪个？" }] };
    expect(pendingClarifyOf([ev(c)])!.callId).toBe("q1");
    expect(pendingClarifyOf([ev(c), ev({ type: "tool_result", callId: "q1", ok: true, output: "" })])).toBeNull();
    const p = { type: "plan_proposed", callId: "p1", plan: { goal: "g", files: [] } };
    expect(pendingPlanOf([ev(p)])!.plan.goal).toBe("g");
    expect(pendingPlanOf([ev(p), ev({ type: "plan_approved", callId: "p1", approved: true })])).toBeNull();
  });
  it("phase 修正：tool_result 收尾不再是 tool；delta 晚于 result 是 thinking", () => {
    expect(deriveRunPhase([ev({ type: "tool_call", id: "t", name: "x", args: {} }), ev({ type: "tool_result", callId: "t", ok: true, output: "" })], false, false, false)).toBe("idle");
    expect(deriveRunPhase([ev({ type: "tool_result", callId: "t", ok: true, output: "" }), ev({ type: "assistant_delta", callId: "c", text: "x" })], false, false, false)).toBe("thinking");
    expect(deriveRunPhase([], false, true, false)).toBe("clarify");
    expect(deriveRunPhase([], true, true, false)).toBe("ask");
  });
  it("usageAggregate 与 relativeTime", () => {
    expect(usageAggregate([ev({ type: "usage", inputTokens: 10, outputTokens: 5 }), ev({ type: "usage", inputTokens: 1, outputTokens: 2 })]))
      .toEqual({ inputTokens: 11, outputTokens: 7, usageCount: 2 });
    expect(relativeTime(1_000_000, 1_000_000 - 30_000)).toBe("刚刚");
    expect(relativeTime(1_000_000, 1_000_000 - 5 * 60_000)).toBe("5 分钟前");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter m0-desktop test`
Expected: FAIL（新形状未实现）。

- [ ] **Step 3: 实现 projections.ts v2**（按 Interfaces 语义逐条实现；M1 的 `summarize` 保留）

- [ ] **Step 4: 跑测试确认绿**（`pnpm --filter m0-desktop test`，全部用例含 M1 存量）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/projections.ts apps/desktop/tests/projections.test.ts
git commit -m "桌面端 M2-2：投影 v2——delta 按 callId 分桶流式（live 行，终稿取代）、工具待定态（callId↔id 收口 ok）、行级 ts 透传（旧日志留空不造假）、phase 五态修正（tool_result 收尾=idle/error 归流）、pendingClarify/pendingPlan 选择器（tool_result/plan_approved 收口）、usageAggregate＋relativeTime"
```

---

### Task 3: 渲染升级（流式行/待定脉冲/时间戳/会话相对时间/事件分桶过滤）

**Files:**
- Modify: `apps/desktop/src/renderer/components/Stream.tsx`、`components/Sidebar.tsx`、`App.tsx`、`styles.css`

**Interfaces:**
- Consumes: Task 2 投影面全量。
- Produces: App 的 onEvent 处理按 `session_id === activeId` 过滤进流（非活跃会话只更新侧栏 running 集合）——M1 账本 T5"串屏"项收口。

- [ ] **Step 1: 组件与样式落地**

`Stream.tsx`：assistant `live` 行尾部渲染呼吸光标 `▮`（CSS 动画，同 `.dot.breathe` 手法）；tool `pending` 行图标替换为脉冲点、结束后按 `ok` 显示 `⌁`/`✕`；行右侧安静时间戳：`ts` 存在时 `<span title={new Date(ts).toLocaleString()}>{relativeTime(Date.now(), ts)}</span>`（字体 var(--text-3)、10px），无 ts 不渲染。

`Sidebar.tsx`：会话行次级文字加 `relativeTime(Date.now(), s.updatedAt ? Date.parse(s.updatedAt) : s.mtimeMs)`（updatedAt 是 ISO 字符串或缺席，回退 mtimeMs；解析失败回退 mtimeMs，再失败不显示）。

`App.tsx`：①onEvent 回调里 `const sid = e.session_id; if (sid && sid !== activeIdRef.current) { runningSet 更新; return; }`（用 ref 存当前 activeId 避免闭包过期）；②`deriveRunPhase(events, ask!==null, clarify!==null, plan!==null)` 三参全接；③`pendingClarifyOf/pendingPlanOf(events)` 提到渲染体，接 Task 5 的卡（本任务先渲染占位空态也不报错——两任务同分支串行，Task 5 直接填真卡）。

`styles.css`：追加 `.cursor-breathe`、`.tool-pending`（图标脉冲）、`.row-time`（安静时间戳）三条，颜色全部用既有变量。

- [ ] **Step 2: 验证**

Run: `pnpm --filter m0-desktop typecheck && pnpm --filter m0-desktop build && pnpm --filter m0-desktop test`
Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css
git commit -m "桌面端 M2-3：渲染升级——live 行呼吸光标、工具待定脉冲＋ok/✕ 收口、行级安静时间戳（hover 精确、旧日志留空）、侧栏相对时间、onEvent 按 activeId 分桶过滤（M1 T5 串屏项收口）"
```

---

### Task 4: 模型选择器 + tokens 面板

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`、`components/ModelPicker.tsx`（新）、`components/TokenPanel.tsx`（新）
- Test: `apps/desktop/tests/model-picker.test.ts`

**Interfaces:**
- Consumes: `window.agent.getProviderInfo(): Promise<ProviderInfo>`（`providers: ProviderInfo[]` 形状见 `src/main/provider-runtime.ts:22`——多 provider 时渲染层按数组铺；`ProviderModelInfo extends ModelSpec`，**价格字段是否在 ModelSpec 上由本任务 Step 1 勘定**）。
- Produces: 会话条 `ModelPicker`（下拉：demo 常驻首项"演示（无 registry id）"，其余按 provider→models 两级铺）；选中值存 `Map<sessionId, registryId|null>`（内存态，M4 才落 settings）；run 时 `model: selected ?? undefined` 透传。`TokenPanel`：会话条 meta 位渲染 `usageAggregate(events)` → `↑in ↓out`；**价格**：若 Step 1 勘得 ModelSpec 有单价字段则乘出 `$` 估算，否则显示 `–` 并在报告记明数据源缺席。

- [ ] **Step 1: 勘定 ProviderInfo/ModelSpec 真实形状**

Run: `grep -n "interface ModelSpec" -A 20 src/providers/registry.ts | head -30`
Expected: 确认 models 的 id/名称/价格字段面。价格字段缺席 ⇒ TokenPanel 按"只有 tokens"实现（计划裁定：M2 不为 cost 引入新数据源，等 M4 BYOK 时随 provider 配置一并落）。

- [ ] **Step 2: 写失败测试**

`apps/desktop/tests/model-picker.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { flattenModels } from "../src/renderer/components/ModelPicker";

describe("flattenModels", () => {
  it("demo 常驻首项，provider→models 两级铺平", () => {
    const opts = flattenModels([
      { kind: "demo", provider: "demo", model: "demo-fixture", modelId: null, models: [], capability: {} as never },
      { kind: "openai", provider: "openai", model: "gpt-x", modelId: "openai-standard", models: [
        { id: "openai-standard/gpt-x", label: "GPT-X", capability: {} as never },
      ] } as never,
    ]);
    expect(opts[0]).toMatchObject({ registryId: null, label: "演示" });
    expect(opts[1]).toMatchObject({ registryId: "openai-standard/gpt-x", provider: "openai" });
  });
});
```

（`ProviderInfo`/`ProviderModelInfo` 的真实必填字段以 typecheck 为准——本测试的 `as never` 只在勘定 Step 1 后按真形收窄。）

- [ ] **Step 3: 实现 ModelPicker（flattenModels 纯函数 + select 组件）与 TokenPanel，App 接线**（选择态 `useRef<Map>`＋`useState` 触发重渲；run 组装处透传 `model`）

- [ ] **Step 4: 验证**（test/typecheck/build 三绿；`getProviderInfo` 桥在 M1 已通，真值冒烟留给 Task 8）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer components apps/desktop/tests/model-picker.test.ts
git commit -m "桌面端 M2-4：会话条模型选择器（getProviderInfo 目录两级铺平、demo 常驻、per-session 内存态、RunRequest.model 透传）＋tokens 面板（usage 事件聚合 ↑in ↓out；价格按 ModelSpec 勘定结果或显式 –）"
```

---

### Task 5: 三卡（审批 scope 展开 / 澄清表单 / 方案决议）

**Files:**
- Modify: `apps/desktop/src/renderer/components/ApprovalCard.tsx`、`App.tsx`、`styles.css`
- Create: `apps/desktop/src/renderer/components/ClarifyCard.tsx`、`components/PlanCard.tsx`
- Test: `apps/desktop/tests/cards.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `pendingClarifyOf/pendingPlanOf`；AgentApi 既有 `decide(askId, approved, scope)`、`submitClarify(callId, answers: ClarifyAnswerMap)`、`decidePlan(approved, callId?)`。
- Produces:
  - ApprovalCard："总是允许"点击展开两选（`session_kind`＝"本会话此类" / `always`＝"总是"），选定即 `decide(askId, true, scope)`；允许/拒绝两键不变（scope 缺省 once）。
  - ClarifyCard：`questions` 渲染表单（`options` 有 ⇒ 单选/多选，multiSelect 按 `ClarifyQuestion.multiSelect`；无 ⇒ 文本框）；提交组 `ClarifyAnswerMap`（key=问题原文）调 `submitClarify(callId, answers)`。
  - PlanCard：`plan.goal/files[].path+action+summary/approach/verify` 渲染决议卡；批准/拒绝调 `decidePlan(approved, callId)`。
  - App：三卡同位渲染（审批 ask 走 onAsk 状态，澄清/方案走事件选择器），卡片互斥显示（ask > clarify > plan）。

- [ ] **Step 1: 写失败测试**

`apps/desktop/tests/cards.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { clarifyFormValues, planFileLines } from "../src/renderer/components/cards";

describe("卡片纯函数", () => {
  it("clarifyFormValues：单选取 label、多选收集数组、自由项取输入", () => {
    const v = clarifyFormValues(
      [{ question: "Q1", options: [{ label: "A" }, { label: "B" }] }, { question: "Q2", multiSelect: true, options: [{ label: "X" }, { label: "Y" }] }, { question: "Q3" }],
      { Q1: "A", Q2: ["X", "Y"], Q3: "自己写" },
    );
    expect(v).toEqual({ Q1: "A", Q2: ["X", "Y"], Q3: "自己写" });
    expect(() => clarifyFormValues([{ question: "Q", options: [{ label: "A" }] }], {})).toThrow(/必答/);
  });
  it("planFileLines：path+action+summary 组行", () => {
    expect(planFileLines([{ path: "a.ts", action: "edit", summary: "改窗格" }]))
      .toEqual(["edit  a.ts — 改窗格"]);
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（cards.ts 纯函数 + 两组件 + ApprovalCard scope 展开 + App 接线）→ Step 4: 三绿**（test/typecheck/build）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css apps/desktop/tests/cards.test.ts
git commit -m "桌面端 M2-5：三卡——审批卡 scope 展开（session_kind/always 两选沉淀权限规则）、澄清卡（单选/多选/自由文本，ClarifyAnswerMap 提交 submitClarify）、方案卡（goal/files/approach/verify，decidePlan 决议）；三卡同位互斥（ask>clarify>plan）"
```

---

### Task 6: composer 运行中禁用 + worker 事件断言补强

**Files:**
- Modify: `apps/desktop/src/renderer/components/Composer.tsx`、`apps/desktop/tests/kernel-host.test.ts`

**Interfaces:**
- Produces: Composer `disabled` 语义升级为真禁用（input `disabled` 属性 + onKeyDown guard + 视觉降不透明度）；placeholder 固定"会话运行中…"（**裁定：真排队语义需要内核新增续跑通道，AgentApi 无此面——M2 不造排队假象，M3+ 若内核提供追加通道再实装**）。
- kernel-host 测试补强（M1 账本 T3 项）：demo run 的 outbox 断言加 `agent_spawned` ≥1 与 `agent_result` ≥1（demo 剧本派两个 worker，事件在流里；断言事件类型存在而非内容形状——worker 报告内容不钉死）。

- [ ] **Step 1: 改 Composer（真禁用）与 kernel-host.test（两行断言）**
- [ ] **Step 2: `pnpm --filter m0-desktop test` 全绿（含 M1 既有 run 用例仍绿——worker 事件断言若在 demo 剧本下不成立，先勘 `fixtures/agents/main-demo.jsonl` 的 worker 是否真跑完，断言按事实写）**
- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/Composer.tsx apps/desktop/tests/kernel-host.test.ts
git commit -m "桌面端 M2-6：composer 运行中真禁用（排队语义裁定：内核无追加通道，M2 不造假象）＋demo run 断言补 worker 面（agent_spawned/agent_result 各≥1）"
```

---

### Task 7: 审批→执行→打断 全链路 headless 判卷

**Files:**
- Create: `fixtures/agents/main-approval-demo.jsonl`
- Test: `apps/desktop/tests/approval-e2e.test.ts`

**Interfaces:**
- Consumes: `M3A_MAIN_SCRIPT=<绝对路径>`（`scriptedMainModelPath` 第一优先通道，`agent-runner.ts:328`）；kernel-host 三方法 run/decide/cancel。
- Produces: M2 验收锚的机器证明——"mock 全链路审批→执行→打断"。

fixture 形状（沿 `main-demo.jsonl` 逐行事件样式；`id` 自定义任意稳定串）：

```jsonl
{"type":"assistant_message","content":"我需要在临时目录建一个标记文件，先请求许可。"}
{"type":"tool_call","id":"shell-1","name":"run_shell","args":{"command":"touch approval-marker.tmp"}}
{"type":"assistant_message","content":"完成。"}
```

`run_shell` 是写副作用工具，`mode: "default"` 下必经 appAskGate（`agent-runner.ts:5` 头注语义）。worker 引用为零（args.model 缺席 ⇒ 不 spawn）。

- [ ] **Step 1: 写 fixture**（落 `fixtures/agents/main-approval-demo.jsonl`；**新增夹具不碰冻结件**）
- [ ] **Step 2: 写失败测试**

`apps/desktop/tests/approval-e2e.test.ts` 骨架（沿用 kernel-host.test 的 host 装配手法；两用例共用一个 fixture 路径常量）：

```ts
const script = join(repoRoot, "fixtures", "agents", "main-approval-demo.jsonl");
// repoRoot 由 import.meta.url 上溯，或 process.cwd() 断言在 apps/desktop —— 以测试实际 cwd 勘定

it("审批→执行：ask 到达 → decide(approved) → run ok 且 marker 落工作区", async () => {
  process.env.M3A_MAIN_SCRIPT = script;
  const host = createKernelHost({ workspace, userDataDir, outbox });
  const runP = host.run({ message: "建标记", mode: "default", sessionId: (await host.createSession()).id });
  await vi.waitFor(() => expect(outbox.some(([c, p]) => c === "onAsk" && (p as { tool: string }).tool === "run_shell")).toBe(true));
  const ask = outbox.find(([c]) => c === "onAsk")![1] as { askId: string };
  expect(host.decide(ask.askId, true)).toBe(true);
  expect((await runP).ok).toBe(true);
  expect(existsSync(join(workspace, "approval-marker.tmp"))).toBe(true);
}, 30_000);

it("打断：ask 等待期 runCancel → run 收束（ok false 或 error 提及取消），无 marker", async () => {
  // 同装配；ask 到达后先 cancel 再（或）不 decide：
  //   runCancel 语义（ipc-protocol.ts:161 注释）＝信号沿"门等待"透传 ⇒ run 收束、ask fail-closed
  //   断言：await runP 的返回不含 ok:true，且 outbox 有 onAskDone 且 reason 属 timeout|unattended|user 之一
}, 30_000);
```

断言细节以实测为准的勘误窗口：cancel 后 run 的返回形状（ok:false+error 或 ok:true+aborted 事件）以 `agent-runner` 的取消语义真实行为为准——**只钉"不产生 marker + run 收束 + 无悬挂 promise"三条硬判据**，返回形状如实记录进报告。

- [ ] **Step 3: 跑红→修绿**（若 scripted main 对 `run_shell` 的门语义与预期不符——例如脚本化通道强制 auto 档绕过 ask——勘 `scriptedMainModelPath` 消费侧与 mode 传递链，调 fixture/mode/断言至真语义；两轮调不通 BLOCKED 并贴机制）
- [ ] **Step 4: 全绿**（`pnpm --filter m0-desktop test` 全量；`M0_SMOKE=1` 冒烟仍 PASS）
- [ ] **Step 5: Commit**

```bash
git add fixtures/agents/main-approval-demo.jsonl apps/desktop/tests/approval-e2e.test.ts
git commit -m "桌面端 M2-7：审批→执行→打断全链路 headless 判卷——新增 main-approval-demo 夹具（run_shell 写副作用触发 appAskGate，零 worker），两用例钉硬判据（approve 后 marker 落工作区 run ok；门等待期 cancel 后 run 收束无 marker），返回形状按真实取消语义如实记录"
```

---

### Task 8: 扫描器硬化 + M2 全量验收

**Files:**
- Modify: `scripts/desktop-boundary-check.ts`、`apps/desktop/package.json`（冒烟脚本固化）

**Interfaces:**
- Produces: 扫描器补 `require(` 面与 `.mjs/.cjs/.jsx` 扩展名（终审 deferred triage 项）；`pnpm --filter m0-desktop smoke` 一键冒烟。

- [ ] **Step 1: 扫描器扩展**（正则加 `require\(\s*["'][^"']*(apps\/desktop|electron)`；walk 扩展名集合加 mjs/cjs/jsx。先红后绿自验：加 `src/__probe2__.cjs`（内容 `require("electron")`）应红，删后绿）
- [ ] **Step 2: package.json 加 `"smoke": "node scripts/smoke.mjs"`**——新建 `apps/desktop/scripts/smoke.mjs`：生成 mktemp 工作区、带 `M0_SMOKE=1 M0_DESKTOP_WORKSPACE=<tmp> exec electron .`、透传退出码（把 M1-6 的命令行咒语固化为脚本）
- [ ] **Step 3: 全量验收**：`pnpm --filter m0-desktop test`（含 Task 7 两用例）＋ `pnpm --filter m0-desktop smoke`（exit 0）＋ `pnpm gates`（含边界门）＋ `pnpm typecheck` ＋ 根 vitest 形状一致
- [ ] **Step 4: Commit**

```bash
git add scripts/desktop-boundary-check.ts apps/desktop/package.json apps/desktop/scripts/smoke.mjs
git commit -m "桌面端 M2-8：边界扫描器硬化（require( 面＋mjs/cjs/jsx 扩展名，先红后绿自验）＋M0_SMOKE 固化为一键 smoke 脚本；M2 全量验收（投影判卷含缺 ts 兼容、审批→执行→打断、冒烟、gates）全绿"
```

---

## Self-Review（已执行）

1. **Spec 覆盖**：§3.5 ts 增量→T1；§6.2 行级时间戳/侧栏相对时间→T2/T3；§6.3 delta 流式/呼吸态/工具待定态→T2/T3；模型选择器→T4；tokens·cost→T4（cost 按 ModelSpec 勘定，缺席则显式"–"，不造假——spec 的 cost 呈现依赖价格数据源，M4 BYOK 时一并补）；三卡＋scope 沉淀→T5；composer 运行中→T6（排队裁定为禁用，理由记裁定）；§11 M2 验收锚"投影判卷绿（含缺 ts 旧日志兼容）"→T1/T2；"mock 全链路审批→执行→打断"→T7。**遗留到 M3 的**：多会话并行状态点完整化（M2 只做事件分桶过滤）、工作区注册表 UI、漂移检测。
2. **占位扫描**：T4 Step 1（ModelSpec 价格勘定）与 T7 Step 3（取消返回形状勘定）为勘误窗口，均配了具体勘误手段与硬判据兜底；无 TBD。
3. **类型一致**：StreamRow/RunPhase v2 在 T2 定义、T3 消费同型；pendingClarifyOf/pendingPlanOf 返回形状与 T5 卡组件 props 对齐；`eventTimestamps` 名字在 RunOverrides/runAgent opts/kernel-host 三处一致；fixture 事件形状与 `ToolCallEvent`（id/name/args）逐字对齐。
