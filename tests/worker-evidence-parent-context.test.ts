// 能力 5 的**并行那一半**：worker 的机器证据要落到「主模型看得见的那一条正文」上，
// 而且这条落点必须**由设置位驱动**。
//
// 已有的观测者读的是别的格子（三处突变实测，逐条见第 61 页 §1）：
//  - `tests/m3b.test.ts` 的 W4 三条断的是**事件 output 字符串**里有没有那一行（手写子流 + 直调
//    `new Orchestrator` + 手喂 `workerVerify`）。把证据从合成正文里摘掉它红 2 条 ⇒ 那一格不空。
//  - 但「设置 `autoVerify` 到底接没接到 worker 的收束闸上」（`agent-runner.ts` 的 W4a 那一行）
//    实测**摘掉后全仓只有本文件红**（同跑的 m3b / worker-project-rules / supervise-evidence
//    共 40 条全绿）——判卷自己 `new Orchestrator` 就守不到产品那次构造（规则 123 的第三次命中）。
//  - 而 `m3b.test.ts` 此刻正在另一条线上被删（`git status` 显示 `D tests/m3b.test.ts`）：
//    它落地后，"证据在不在父模型正文里" 这一格只剩本文件一个观测者。
//
// 本文件的形状与 `tests/repair-loop-real-verify.test.ts` 同一档：走真产品入口，且验证结论
// **取决于盘**。worker 用仓里既有剧本 `fixtures/agents/write-demo.jsonl`（真写 `demo/config.ts`），
// 目标仓的 verify 命令是 `grep` 那个文件里的一行 ⇒ 同一条剧本、只换命令，字段就得跟着翻。
// 全程 mock provider + 真 git worktree ⇒ 零模型花费。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

import { handleAgentRun, initSettingsStore } from "../src/main/agent-runner";
import { projectContext } from "../src/agent/context";
import type { AgentEvent } from "../src/events";

const exec = promisify(execFile);
const dirs: string[] = [];

afterAll(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  delete process.env.M3A_AGENTS_DEMO;
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

/** write worker 要真 worktree ⇒ 靶子必须是一个有 HEAD 的 git repo。 */
async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wev-root-"));
  dirs.push(root);
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...args: string[]): Promise<unknown> => exec("git", args, { cwd: repo });
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  await g("init");
  await g("config", "user.email", "wev@test.local");
  await g("config", "user.name", "WEV Test");
  await g("add", ".");
  await g("commit", "-m", "init");
  return repo;
}

/** 一场跑：主会话（真产品入口）派一个 write worker，worker 自己跑收束闸那一拍。
 *  `test` = 目标仓的 verify 命令——它是本文件唯一随格变的东西。 */
async function spawnWriteWorker(test: string): Promise<{ events: AgentEvent[]; repo: string }> {
  const home = await mkdtemp(join(tmpdir(), "wev-home-"));
  dirs.push(home);
  const repo = await makeRepo();
  initSettingsStore(join(home, "settings.json"));
  // 只开 autoVerify：worker 的收束闸复用这一个设置位（agent-runner 的 W4a 那一行），
  // 所以这条用例同时钉住「设置 → 装配 → worker 真补了一拍」的接线，不只是载荷形状。
  await writeFile(join(home, "settings.json"), JSON.stringify({ autoVerify: true }), "utf8");
  await mkdir(join(repo, ".agent"), { recursive: true });
  // 两条批条都是**前提**而不是装饰：`write-demo.jsonl` 先 write_file 再 `shell_rw git status`，
  // 缺任一条批条 ⇒ worker 卡在 waiting_approval（实测现场：statuses 末位就是它），
  // 终态回执永远不来，下面所有断言都会红在错误的因上。
  await writeFile(
    join(repo, ".agent", "permissions.json"),
    JSON.stringify({
      rules: [
        { behavior: "allow", tool: "write_file", scope: "always" },
        { behavior: "allow", tool: "shell_rw", scope: "always" },
      ],
    }),
    "utf8",
  );
  await writeFile(join(repo, ".agent", "config.json"), JSON.stringify({ verify: { test: [test] } }), "utf8");
  // **必须提交**：write worker 的 verify 钩子挂在 worktree 上（`orchestrator.ts` 的
  // `workerVerify?.(loopWorkspace)`，验的是「即将被合并的那份代码」），而 `surface()` 从那个目录读
  // `.agent/config.json` —— 未提交的文件不在 worktree 里 ⇒ surface false ⇒ 整拍静默跳过、
  // 证据恒 `absent`（这一格本身单独立项，见第 61 页 §2）。
  const g = (...args: string[]): Promise<unknown> => exec("git", args, { cwd: repo });
  await g("add", "-A");
  await g("commit", "-m", "verify surface");
  const mainScript = join(home, "main.jsonl");
  await writeFile(
    mainScript,
    [
      {
        type: "tool_call",
        id: "sp-1",
        name: "spawn_agent",
        args: { mode: "write", task: "新增示例配置文件 demo/config.ts", model: "write-demo.jsonl" },
      },
      { type: "assistant_message", content: "已派 worker 去写。" },
    ].map((o) => JSON.stringify(o)).join("\n") + "\n",
    "utf8",
  );
  process.env.M3A_MAIN_SCRIPT = mainScript;
  process.env.M3A_AGENTS_DEMO = "1";

  const seen: AgentEvent[] = [];
  const run = await handleAgentRun(
    { message: "派 worker 写示例配置", mode: "auto" },
    { workspace: repo, logPath: join(home, "events.jsonl"), unattended: true, onEvent: (e) => { seen.push(e); } },
  );
  expect(run.ok, JSON.stringify(run)).toBe(true);
  // worker 终态是**异步**落到主流上的：主 run 收口时合成回执可能还没到，而 0 条看起来跟
  // 「回执丢了」一样像话 ⇒ 等到出现那一笔（等不到就红，红时带现场：卡在谁身上要一眼看得见）。
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !seen.some(isSyntheticResult)) await new Promise((r) => setTimeout(r, 25));
  expect(
    seen.some(isSyntheticResult),
    "worker 的终态回执没回到主流 ⇒ 现场: " +
      JSON.stringify({
        types: seen.map((e) => e.type),
        statuses: seen.filter((e) => e.type === "agent_status").map((e) => [e.agent_id, e.status]),
        approvals: seen.filter((e) => e.type === "approval_requested").map((e) => [e.id, e.tool]),
        results: seen
          .filter((e) => e.type === "tool_result" && (e as { agent_id?: string }).agent_id !== undefined)
          .map((e) => {
            const r = e as Extract<AgentEvent, { type: "tool_result" }>;
            return [r.callId, r.ok, String(r.output).slice(0, 60)];
          }),
      }),
  ).toBe(true);
  return { events: seen, repo };
}

const isSyntheticResult = (e: AgentEvent): boolean =>
  e.type === "tool_result" &&
  (e as { agent_id?: string }).agent_id === undefined &&
  (e as { callId: string }).callId === "sp-1" &&
  String((e as { output: string }).output).includes("worker 回传");

/** 主模型下一轮真正收到的那条正文（投影面，不是事件面）。 */
function parentVisible(events: AgentEvent[]): { toolMessages: number; orphaned: number; content: string } {
  const msgs = projectContext(events);
  const tools = msgs.filter((m) => m.role === "tool" && m.tool_call_id === "sp-1");
  const orphans = msgs.filter((m) => m.role === "user" && String(m.content).includes("没有配对的调用声明"));
  return { toolMessages: tools.length, orphaned: orphans.length, content: String(tools[0]?.content ?? "") };
}

describe("worker 的验证证据落到主模型看得见的那条正文（能力 5 并行面）", () => {
  it(
    "worker 写了盘、verify 在 worktree 里真过 ⇒ 正文带 `\"verified\": \"verified\"`，且它是配对好的 tool 消息",
    { timeout: 120_000 },
    async () => {
      const { events } = await spawnWriteWorker("grep -q 'retries: 3' demo/config.ts");
      // 前提：那一拍真的发生了（没有这一位，下面的字段就是读来的旧状态）
      expect(
        events.some((e) => e.type === "verify_result" && (e as { auto?: boolean }).auto === true && e.ok),
        "worker 的自动拍没落流 ⇒ 设置位没接到 worker 上，这条就成了假见证",
      ).toBe(true);
      const v = parentVisible(events);
      expect(v.toolMessages, "spawn 的执行回执与 worker 回传必须并成一条 tool 消息").toBe(1);
      expect(v.orphaned).toBe(0);
      expect(v.content).toContain('"verified": "verified"');
    },
  );

  it(
    "同一条剧本、只换 verify 命令（盘上没那么写）⇒ 字段跟着盘翻成 `failed`：它不是常量",
    { timeout: 120_000 },
    async () => {
      const { events } = await spawnWriteWorker("grep -q NEVER-ON-DISK demo/config.ts");
      const v = parentVisible(events);
      expect(v.content).toContain('"verified": "failed"');
      expect(v.content, "红的证据不许同时报成绿").not.toContain('"verified": "verified"');
    },
  );

  it(
    "没写盘的只读 worker ⇒ 正文里压根没有 `verified` 键（不给没碰过的代码发证据）",
    { timeout: 120_000 },
    async () => {
      const home = await mkdtemp(join(tmpdir(), "wev-read-"));
      dirs.push(home);
      const repo = await makeRepo();
      initSettingsStore(join(home, "settings.json"));
      await writeFile(join(home, "settings.json"), JSON.stringify({ autoVerify: true }), "utf8");
      await mkdir(join(repo, ".agent"), { recursive: true });
      await writeFile(join(repo, ".agent", "config.json"), JSON.stringify({ verify: { test: ["true"] } }), "utf8");
      const mainScript = join(home, "main.jsonl");
      await writeFile(
        mainScript,
        [
          { type: "tool_call", id: "sp-1", name: "spawn_agent", args: { mode: "read", task: "读 README", model: "read-worker.jsonl" } },
          { type: "assistant_message", content: "读完了。" },
        ].map((o) => JSON.stringify(o)).join("\n") + "\n",
        "utf8",
      );
      process.env.M3A_MAIN_SCRIPT = mainScript;
      process.env.M3A_AGENTS_DEMO = "1";
      const seen: AgentEvent[] = [];
      const run = await handleAgentRun(
        { message: "派只读 worker 看一眼", mode: "auto" },
        { workspace: repo, logPath: join(home, "events.jsonl"), unattended: true, onEvent: (e) => { seen.push(e); } },
      );
      expect(run.ok, JSON.stringify(run)).toBe(true);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && !seen.some(isSyntheticResult)) await new Promise((r) => setTimeout(r, 25));
      expect(seen.some(isSyntheticResult), "只读 worker 的回执没回来").toBe(true);
      const v = parentVisible(seen);
      expect(v.content).toContain("worker 回传");
      expect(v.content, "只读 worker 没有改动，任何 `verified` 值都是无凭据的声明").not.toContain('"verified"');
    },
  );
});
