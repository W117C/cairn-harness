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
import { runAgent } from "../src/main/agent-runner";
import type { AgentEvent } from "../src/events";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUG = join(ROOT, "fixtures", "mock", "todo-bug.ts");

let dirs: string[] = [];

afterEach(async () => {
  delete process.env.M7_IMPACT_TAGS_DIR;
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
      const events = await runOnce(await freshWs(), {});
      expect(writeResult(events)?.ok, "写盘都没成功，这条就成了假绿（零事件可以是没写）").toBe(true);
      expect(events.filter((e) => e.type === "impact_report").length).toBe(0);
      expect(writeResult(events)?.output ?? "").not.toContain("[impact]");
    },
  );
});
