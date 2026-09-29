// M7 影响面的**第三环**：`settings.impactAnalysis` ⇒ `agent-runner` 真构造钩子并透传进 runLoop
// ⇒ 事件流里真出现 impact_report、写工具的输出真带回 `[impact]` 摘要。
//
// 为什么单独要这一支：`tests/impact-wiring.test.ts` 是**手搭 ToolContext** 验的
// （`ctx.impact = defaultImpactHook(...)` 由测试自己塞），所以「runner 里那行构造被删掉」它照绿。
// 本仓已经栽过 9 次「两头断」——模块、事件、消费端齐了，中间那根线没人接，而每一环各自有测。
// 这一支不手搭 ctx，走 `runAgent` 真实入口，并**成对**钉那个开关：
//   开 ⇒ 必须出现；关（缺省）⇒ 一条都不许出现，但同一条写工具调用必须仍然成功
//   （否则「关」那半边会被「根本没写盘」满足，等于没测）。
//
// 工作区是**现搭的临时目录**而不是 `fixtures/todo-app`：那份靶子的 `src/todo.ts` 被本仓
// .gitignore 显式忽略（跑完留下的状态不进 git），而扫描层走 `rg --files` 尊重 .gitignore
// ⇒ 它压根不在影响图内，钩子按契约返回 null、不发事件。用靶子会量出一个假红
// （2026-09-22 首版就踩在这里，先误判成"第三环断了"，`buildImpact().files` 只回了 tests/*）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runAgent, handleAgentRun, initSettingsStore } from "../src/main/agent-runner";
import type { AgentEvent } from "../src/events";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUG = join(ROOT, "fixtures", "mock", "todo-bug.ts");

let dirs: string[] = [];

/** 本文件首跑时看到的兜底值（vitest.config.ts 设的那个），用于 afterEach 还原。 */
const impactTagsBase: string | undefined = process.env.M7_IMPACT_TAGS_DIR;

afterEach(async () => {
  // 还原而不是删掉：vitest.config.ts 把它兜到临时目录（`impactAnalysis` 缺省开之后，
  // 十来个只跑 agent 的用例也会走建图），`delete` 会把那个兜底一并摘掉，
  // 于是同进程里排在后面的文件又落回 `~/.m0-agent-loop/impact-tags`。
  if (impactTagsBase === undefined) delete process.env.M7_IMPACT_TAGS_DIR;
  else process.env.M7_IMPACT_TAGS_DIR = impactTagsBase;
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});

/** 临时工作区：src/todo.ts（被改的那个）+ src/app.ts（跨文件调用它）⇒ 图内一定有它。 */
async function freshWs(): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), "impact-runner-ws-"));
  dirs.push(ws);
  await mkdir(join(ws, "src"), { recursive: true });
  await writeFile(join(ws, "src", "todo.ts"), await readFile(BUG, "utf8"));
  await writeFile(
    join(ws, "src", "app.ts"),
    'import { addTodo } from "./todo";\naddTodo("买牛奶");\n',
  );
  return ws;
}

/** 跑一轮 mock 剧本（read src/todo.ts → write_file src/todo.ts → run_shell）。 */
async function runOnce(ws: string, extra: { impactAnalysis?: boolean }): Promise<AgentEvent[]> {
  const tags = await mkdtemp(join(tmpdir(), "impact-runner-tags-"));
  dirs.push(tags);
  process.env.M7_IMPACT_TAGS_DIR = tags; // 缓存不许落进真实应用数据目录，更不许落进仓库
  const seen: AgentEvent[] = [];
  await runAgent({
    workspace: ws,
    message: "给待办应用加个开关",
    mode: "auto",
    logPath: join(tags, "events.jsonl"),
    onEvent: (e) => {
      seen.push(e);
    },
    sandbox: null,
    ...extra,
  });
  return seen;
}

/** 那条 write_file 的结果（两侧都要先看它成没成功，否则"零事件"可以是没写盘）。 */
function writeResult(events: AgentEvent[]) {
  const call = events.find(
    (e): e is Extract<AgentEvent, { type: "tool_call" }> => e.type === "tool_call" && e.name === "write_file",
  );
  if (call === undefined) return undefined;
  return events.find(
    (e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.callId === call.id,
  );
}

describe("影响面第三环：settings ⇒ 构造点 ⇒ 事件流（走真实 runAgent，不手搭 ctx）", () => {
  it(
    "开：写盘后事件流里真有 impact_report，且摘要回进了 tool_result",
    { timeout: 180_000 },
    async () => {
      const events = await runOnce(await freshWs(), { impactAnalysis: true });
      expect(writeResult(events)?.ok, "写工具没成功 ⇒ 这条测不到构造点").toBe(true);
      const reports = events.filter(
        (e): e is Extract<AgentEvent, { type: "impact_report" }> => e.type === "impact_report",
      );
      expect(reports.length, "钩子没被构造或没传进 runLoop ⇒ 第三环是断的").toBeGreaterThan(0);
      expect(reports[0].file).toBe("src/todo.ts");
      expect(reports[0].symbols, "报告里连被改文件的符号都没有 = 图没建起来").toContain("addTodo");
      const out = writeResult(events)?.output ?? "";
      expect(out, "事件发了但摘要没回注 = 模型侧仍看不见波及面").toContain("[impact]");
      expect(out).toContain("app.ts");
    },
  );

  it(
    "关（缺省）：一条 impact_report 都不许出现，但同一条写盘仍成功",
    { timeout: 180_000 },
    async () => {
      // 「缺省」说的是**内层 runAgent**：RunOptions.impactAnalysis 没给就是没给，钩子不构造。
      // settings 的缺省开只经 `handleAgentRun` 那层读盘生效（第四环量的是它），不流到这一格。
      // 用例名被 `scripts/mutate-verify.mjs` 的锚点 `runner-impact-hook-always-constructed` 按名引用，
      // 改名＝打断那条变异指针（判卷文件是冻结的，不许改那边来迁就这边）。
      const events = await runOnce(await freshWs(), {});
      expect(writeResult(events)?.ok, "写盘都没成功，这条就成了假绿（零事件可以是没写）").toBe(true);
      expect(events.filter((e) => e.type === "impact_report").length).toBe(0);
      expect(writeResult(events)?.output ?? "").not.toContain("[impact]");
    },
  );
});

/**
 * 第四环：上面两格把开关**直接交给 runAgent**，所以 `agent-runner.ts` 里那行
 * `impactAnalysis: over.impactAnalysis ?? (await store().get()).impactAnalysis` 的**右半边**从未被走过
 * （把整行换成 `?? false`，两格照样绿）。用户在设置界面点的是盘上那个键，不是 overrides——
 * 所以这一支走生产入口 `handleAgentRun`，overrides 一个都不给。
 */
async function runOnceViaProduction(ws: string, settingsRaw: Record<string, unknown>): Promise<AgentEvent[]> {
  const home = await mkdtemp(join(tmpdir(), "impact-runner-prod-"));
  dirs.push(home);
  process.env.M7_IMPACT_TAGS_DIR = home; // 缓存不许落进真实应用数据目录，更不许落进仓库
  initSettingsStore(join(home, "settings.json"));
  await writeFile(join(home, "settings.json"), JSON.stringify(settingsRaw), "utf8");
  await mkdir(join(ws, ".agent"), { recursive: true });
  // 批条必须在场：auto + 无人值守 + 无批条 ⇒ 权限门先拒写，那一环**正确地**不发生，
  // 于是"零事件"可以被没写盘满足（同 auto-verify-wiring ② 的教训）。
  await writeFile(
    join(ws, ".agent/permissions.json"),
    JSON.stringify({ rules: [{ behavior: "allow", tool: "write_file", scope: "always" }] }),
    "utf8",
  );
  const seen: AgentEvent[] = [];
  const res = await handleAgentRun(
    { message: "给待办应用加个开关", mode: "auto" },
    { workspace: ws, logPath: join(home, "events.jsonl"), unattended: true, onEvent: (e) => { seen.push(e); } },
  );
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return seen;
}

describe("影响面第四环：设置盘上的键 ⇒ 生产入口真读它（overrides 一律不给）", () => {
  it(
    "开（只写进 settings.json）：生产入口仍真构造钩子并出 impact_report",
    { timeout: 180_000 },
    async () => {
      const events = await runOnceViaProduction(await freshWs(), { impactAnalysis: true });
      expect(writeResult(events)?.ok, "写工具没成功 ⇒ 这条测不到设置读那一行").toBe(true);
      const reports = events.filter(
        (e): e is Extract<AgentEvent, { type: "impact_report" }> => e.type === "impact_report",
      );
      expect(reports.length, "设置里的 true 没穿过 `over ?? settings` ⇒ 界面开关是空的").toBeGreaterThan(0);
      expect(reports[0].symbols).toContain("addTodo");
    },
  );

  it(
    "反向一侧：盘上**显式**关 ⇒ 生产入口零 impact_report，但写盘仍成功",
    { timeout: 180_000 },
    async () => {
      // 2026-09-27 用户裁决把 impactAnalysis 翻成缺省开，于是「盘上没这个键」不再是反例——
      // 它现在正是一格要成立的**正例**（下面那条）。反例必须显式写 false，否则这条测的是一个
      // 已经被改掉的状态，而「零事件」仍会被没写盘满足。
      const events = await runOnceViaProduction(await freshWs(), { impactAnalysis: false });
      expect(writeResult(events)?.ok, "写盘都没成功 ⇒ 「零事件」可以被没写满足，等于没测").toBe(true);
      expect(events.filter((e) => e.type === "impact_report").length).toBe(0);
    },
  );

  it(
    "缺省开：盘上没这个键（旧机器的 settings.json）⇒ 生产入口照样出 impact_report",
    { timeout: 180_000 },
    async () => {
      const events = await runOnceViaProduction(await freshWs(), {});
      expect(writeResult(events)?.ok, "写盘都没成功 ⇒ 这条测不到设置读那一行").toBe(true);
      const reports = events.filter(
        (e): e is Extract<AgentEvent, { type: "impact_report" }> => e.type === "impact_report",
      );
      expect(reports.length, "缺省开了却没生效 = 读盘回退与 DEFAULT_SETTINGS 不同向").toBeGreaterThan(0);
      expect(reports[0].symbols).toContain("addTodo");
    },
  );
});
