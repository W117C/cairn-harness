# 任务自带判据（task-carried verification）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一次 CLI 开发任务在开工时就带上可执行的验收命令，收束时把结果写成可审计的 `verify_result`，并让账本记到同一条结果。

**Architecture:** 判据从 CLI 人手输入，落进 `session_meta` 的可选字段；`loadVerifyConfig` 之上加一层解析（会话声明 > 仓库配置 > 探测），执行面完全复用现有 `createVerifyHook` / `runVerifyOutcome`；`verify_result` 加 `source` 标明出处。

**Tech Stack:** TypeScript（strict）、Node 20+、vitest、tsx。

**Spec:** `docs/superpowers/specs/2026-11-04-task-carried-verify-design.md`

## Global Constraints

- 工作树有 381 项并发在飞：只改本计划列出的文件，提交只 `git add` 这些路径，绝不 `reset`/`stash`/`checkout` 他人改动。
- 不碰 `apps/**`、`fixtures/gym/**`、`scripts/frozen-sha256.json`。
- 新增字段一律可选；旧日志重放路径必须零改动。
- 8 GB 机器：判卷只跑相关子集，不跑全量 `pnpm gates`。
- 交付前必须跑：`node --import tsx scripts/typecheck.ts`；文档改动另跑 `pnpm docs-check`。

## Review Focus

- `--verify ""` 或纯空白：必须报错退出（EXIT_USAGE），不许被当成"没有声明"静默回落静态配置。
- 命令含 `&&`、管道、引号：整串交给现有 shell 执行，不许二次切词。
- `timeoutMs` 越界（0、负数、超过上限）：报错，不许静默夹取。
- `--session` 续跑：沿用该会话首次声明的命令，不许因"这一轮没带参数"回落到静态配置。
- `verify_result` 先于 `session_meta` 到达（旧日志/异常顺序）：解析不得抛错，按缺省处理。

---

### Task 1: 声明解析层与优先级

**Files:**
- Create: `src/agent/verify-plan.ts`
- Modify: `src/events/types.ts`（`SessionMetaEvent` 加 `verify?`；`VerifyResultEvent` 加 `source?`）
- Test: `tests/verify-plan.test.ts`

**Interfaces:**
- Consumes: `VerifyConfig`、`loadVerifyConfig`（`src/agent/verify.ts:245`）
- Produces:
  - `export interface VerifyDeclaration { commands: string[]; timeoutMs?: number; note?: string }`
  - `export function validateVerifyDeclaration(raw: unknown): { ok: true; value: VerifyDeclaration } | { ok: false; error: string }`
  - `export async function resolveVerifyConfig(repoDir: string, declared?: VerifyDeclaration): Promise<{ config: VerifyConfig; source: "task" | "config" | "probed" | "none" }>`

- [ ] **Step 1: 写失败判卷**

```ts
// tests/verify-plan.test.ts
it("声明压过仓库配置", async () => {
  const dir = await fixtureRepo({ ".agent/config.json": { verify: { test: ["echo config"] } } });
  const r = await resolveVerifyConfig(dir, { commands: ["echo task"] });
  expect(r.source).toBe("task");
  expect(r.config.test).toEqual(["echo task"]);
});
it("无声明时逐字回旧行为", async () => {
  const dir = await fixtureRepo({ ".agent/config.json": { verify: { test: ["echo config"] } } });
  const r = await resolveVerifyConfig(dir);
  expect(r.source).toBe("config");
  expect(r.config.test).toEqual(["echo config"]);
});
```

- [ ] **Step 2: 跑判卷确认红**

Run: `npx vitest run --config tests/vitest.config.ts tests/verify-plan.test.ts`
Expected: FAIL — `resolveVerifyConfig is not exported`

- [ ] **Step 3: 实现解析层**

`resolveVerifyConfig` 只做三件事：有声明则用声明并标 `task`；否则 `loadVerifyConfig` 原样返回并沿用其 `source`；声明里的 `timeoutMs` 按 `MIN_VERIFY_TIMEOUT_MS`/`MAX_VERIFY_TIMEOUT_MS` 校验，越界返回错误而不是夹取。

- [ ] **Step 4: 跑判卷确认绿**

Run: `npx vitest run --config tests/vitest.config.ts tests/verify-plan.test.ts`
Expected: PASS（2 条）

- [ ] **Step 5: 提交（只这一笔）**

```bash
git add src/agent/verify-plan.ts src/events/types.ts tests/verify-plan.test.ts
git commit -m "feat(verify): 会话级判据声明与解析优先级"
```

### Task 2: CLI 接线与证据落盘

**Files:**
- Modify: `src/cli.ts`（解析 `--verify`，写进 `session_meta`）
- Modify: `src/main/agent-runner.ts`（把声明接到 verify 钩子）
- Modify: `src/agent/verify.ts`（`createVerifyHook` 接受已解析的 config）
- Test: `tests/verify-cli-declaration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `resolveVerifyConfig` / `VerifyDeclaration`
- Produces: `--verify <cmd>`（可重复）；`session_meta.verify`；`verify_result.source`

- [ ] **Step 1: 写失败判卷**：断言 `cairn --verify "node -e \"process.exit(1)\"" "x"` 的事件流里存在
  `session_meta.verify.commands = [...]` 与 `verify_result.source === "task"`、`ok === false`、`cause === "code"`。
- [ ] **Step 2: 跑判卷确认红。**
- [ ] **Step 3: 接线**：`--verify` 收集成数组；空白/缺失分别报错与回落；`--session` 续跑时从既有事件流读回首次声明。
- [ ] **Step 4: 跑判卷确认绿**；再跑 `tests/cli-*.test.ts` 回归。
- [ ] **Step 5: 提交**（只加这两个源文件与一个新判卷）。

### Task 3: 账本对账与端到端证据

**Files:**
- Test: `tests/verify-ledger-reconcile.test.ts`
- Create: `outputs/task-carried-verify-2026-11-04/REPORT.md`（非 TS，允许）

**Interfaces:**
- Consumes: `runEvolution` / `appendLedger`（`src/agent/evolution/index.ts:175`）、`extractSignals`
- Produces: 一份对账结论：同一场 run 的事件流读数与账本 `verifyOutcome` 是否一致

- [ ] **Step 1: 写判卷**：造一份含 `verify_result{ok:true}` 的事件日志，调用既有收束读数入口，断言账本新增一条 `verifyOutcome: "green"`。
- [ ] **Step 2: 跑判卷**；若红，先修读数（不许改判卷迁就账本）。
- [ ] **Step 3: 用一笔真实任务跑全链**（需用户批准真模型花费）：任务书带 `--verify`，收束后核对事件流与账本。
- [ ] **Step 4: 写 REPORT.md**：命令、退出码、事件 id、账本条、未证项。
- [ ] **Step 5: 提交**（判卷 + 报告）。

---

## Self-Review

- 覆盖：spec §3.1 覆盖 → Task 3；§3.2 判据声明 → Task 1/2；§5 验收 1–5 → Task 1/2 判卷；§5-6 与 §6 基线 → Task 3 报告。
- 未覆盖且有意不做：桌面端入口（spec §4 已排除）、gym case 冻结与 `PatchReplay`（下一轮）。
- 类型一致：`VerifyDeclaration` / `resolveVerifyConfig` / `source` 四个取值在 Task 1、2、3 中同名同形。
