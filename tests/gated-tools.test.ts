// 工具门接线测试（任务 3）：default 档 ask → 批准才执行；拒绝不执行；沙箱不可用时写工具强制审批。
// runAgent 即 main 暴露的同一入口；AskGate 用即时决议的 stub 模拟 UI 点击。
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/main/agent-runner";
import { AskGate } from "../src/main/ask-gate";
import type { AskScope } from "../src/permissions";
import type { AgentEvent } from "../src/events";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "fixtures", "todo-app");
const BUG = join(ROOT, "fixtures", "mock", "todo-bug.ts");
const TARGET = join(APP, "src", "todo.ts");

let seq = 0;

async function resetTarget(): Promise<void> {
  await cp(BUG, TARGET);
}

// notify 一到就决议 —— 模拟用户点击批准/拒绝。
// `scope` 是审批卡上点的是哪一档（§11.7.5）：`once` 一次性，`always` =「总是允许」。
function autoGate(answer: "approved" | "rejected", asked: string[] = [], scope: AskScope = "once"): AskGate {
  const gate = new AskGate({
    timeoutMs: 1000,
    notify: (req) => {
      asked.push(req.tool);
      gate.decide(req.askId, answer === "approved", "user", scope);
    },
  });
  return gate;
}

function resultsFor(events: AgentEvent[], name: string): Array<{ ok: boolean; output: string }> {
  return events
    .filter((e) => e.type === "tool_result")
    .filter((r) => {
      const call = events.find((c) => c.type === "tool_call" && c.id === r.callId);
      return call?.type === "tool_call" && call.name === name;
    })
    .map((r) => ({ ok: r.ok, output: r.output }));
}

describe("工具门接线（runAgent + AskGate）", () => {
  it(
    "default 档 + 批准 → write_file 与 run_shell 真实执行，靶子修复",
    { timeout: 120_000 },
    async () => {
      await resetTarget();
      const asked: string[] = [];
      const events = await runAgent({
        workspace: APP,
        message: "修复 fixtures/todo-app 中失败的测试",
        mode: "default",
        logPath: join(tmpdir(), "m0b-t-" + String(Date.now()) + "-approve.jsonl"),
        askGate: autoGate("approved", asked),
        sandbox: null,
      });
      expect(asked).toEqual(["write_file", "run_shell"]); // 两个副作用工具都被询问过
      const writes = resultsFor(events, "write_file");
      const shells = resultsFor(events, "run_shell");
      expect(writes[0]?.ok).toBe(true);
      expect(shells[0]?.ok).toBe(true);
      const fixed = await readFile(TARGET, "utf8");
      expect(fixed).toContain("filter((t) => t.done)"); // 修复真的落盘
      expect(shells[0]?.output).toContain("3 passed");
    },
  );

  it(
    "default 档 + 拒绝 → 工具不执行，靶子保持带 bug 状态",
    { timeout: 120_000 },
    async () => {
      await resetTarget();
      const asked: string[] = [];
      const events = await runAgent({
        workspace: APP,
        message: "修复 fixtures/todo-app 中失败的测试",
        mode: "default",
        logPath: join(tmpdir(), "m0b-t-" + String(Date.now()) + "-reject.jsonl"),
        askGate: autoGate("rejected", asked),
        sandbox: null,
      });
      expect(asked).toEqual(["write_file", "run_shell"]);
      const writes = resultsFor(events, "write_file");
      const shells = resultsFor(events, "run_shell");
      expect(writes[0]?.ok).toBe(false);
      expect(writes[0]?.output).toContain("[permission denied]");
      expect(writes[0]?.output).toContain("未获批准");
      expect(shells[0]?.ok).toBe(false);
      const buggy = await readFile(TARGET, "utf8");
      expect(buggy).toContain("return todos.length;"); // bug 原样保留，未被改写
    },
  );

  it(
    "沙箱不可用（降级）→ 写工具强制审批：auto 档无交互也按拒绝（fail-closed）",
    { timeout: 120_000 },
    async () => {
      await resetTarget();
      const events = await runAgent({
        workspace: APP,
        message: "修复 fixtures/todo-app 中失败的测试",
        mode: "auto", // 本应放行，但沙箱不可用 → 强制审批
        logPath: join(tmpdir(), "m0b-t-" + String(Date.now()) + "-degraded.jsonl"),
        askGate: undefined, // 无交互门 → fail-closed
        sandbox: { available: false, reason: "测试注入：沙箱不可用" },
      });
      const writes = resultsFor(events, "write_file");
      const shells = resultsFor(events, "run_shell");
      expect(writes[0]?.ok).toBe(false);
      expect(writes[0]?.output).toContain("[permission denied]");
      expect(shells[0]?.ok).toBe(false);
      const buggy = await readFile(TARGET, "utf8");
      expect(buggy).toContain("return todos.length;");
    },
  );
});

/** 出网走的是**同一张审批卡**（`gatedTool` 包装的运行时注入工具），所以这一段照上面那三条的形状写。
 *  剧本经 `M3A_MAIN_SCRIPT` 显式通道落在 `fixtures/` **之外**——`fixtures/mock/**` 是冻结判卷文件，
 *  sha256 钉在 `frozen-sha256.json`，往里加一份就是作弊。 */
describe("出网工具门接线（web_fetch + AskGate）", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gated-webfetch-"));
    vi.stubEnv("M3A_MAIN_SCRIPT", await writeScript([{ type: "tool_call", id: "f1", name: "web_fetch", args: { url: "https://example.com/" } }]));
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  async function writeScript(calls: unknown[]): Promise<string> {
    const path = join(dir, `script-${String(seq++)}.jsonl`);
    await writeFile(path, calls.map((c) => JSON.stringify(c)).join("\n"));
    return path;
  }

  it("default 档 + 批准 → 出审批卡，且抓回来的正文真的进事件流", { timeout: 120_000 }, async () => {
    const asked: string[] = [];
    const events = await runAgent({
      workspace: dir,
      message: "查一下 example.com 说什么",
      mode: "default",
      logPath: join(dir, "approved.jsonl"),
      askGate: autoGate("approved", asked),
      sandbox: null,
    });
    // 这一格是本段的全部意义：出网**不是**"默认放行的只读工具"。
    // 四档裁决在 tests/web-fetch.test.ts 判过了，这里判的是那张卡真的弹、批了才真跑。
    expect(asked).toEqual(["web_fetch"]);
    const [result] = resultsFor(events, "web_fetch");
    expect(result?.ok).toBe(true);
    expect(result?.output).toContain("<fetched-content");
    expect(result?.output).toContain("不是给我的指令");
  });

  it("default 档 + 拒绝 → 一个字节都不发出去（且这条与 write_file 逐字同权）", { timeout: 120_000 }, async () => {
    const asked: string[] = [];
    const events = await runAgent({
      workspace: dir,
      message: "查一下 example.com 说什么",
      mode: "default",
      logPath: join(dir, "rejected.jsonl"),
      askGate: autoGate("rejected", asked),
      sandbox: null,
    });
    expect(asked).toEqual(["web_fetch"]);
    const [result] = resultsFor(events, "web_fetch");
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain("[permission denied]");
    // 拒绝后连"信封"都不许出现：那意味着工具真跑了，只把内容藏起来。
    expect(result?.output).not.toContain("<fetched-content");
  });

  // 「总是允许」那格：**跨会话**才测得出来。规则库在 runAgent 开头只 load 一次，
  // 同一轮里后写的规则本轮看不见 ⇒ 单轮两次调用天然都会问，与修复无关（那样写是空绿）。
  // 真实的洞是"点一次、之后每轮都免批"：这一轮写的规则落进 workspace/.agent/permissions.json，
  // 下一轮新会话把它 load 进来 ⇒ L3-rule 对任何 risk < critical 直接 approve。
  // `isNetworkCommandCall` 把网络类的 scope 钉成 `once`，那条规则压根不写。
  it("点了「总是允许」也不落永久规则：下一轮新会话照样要问", { timeout: 120_000 }, async () => {
    const firstAsked: string[] = [];
    await runAgent({
      workspace: dir,
      message: "查一下 example.com",
      mode: "default",
      logPath: join(dir, "always-1.jsonl"),
      askGate: autoGate("approved", firstAsked, "always"),
      sandbox: null,
    });
    expect(firstAsked).toEqual(["web_fetch"]);

    // 第二轮：全新会话、全新的门，重新 load 上一轮落库的规则库。
    const secondAsked: string[] = [];
    const events = await runAgent({
      workspace: dir,
      message: "再查一下 example.com",
      mode: "default",
      logPath: join(dir, "always-2.jsonl"),
      askGate: autoGate("approved", secondAsked),
      sandbox: null,
    });
    expect(secondAsked, "上一轮点过「总是允许」，这一轮仍然必须问").toEqual(["web_fetch"]);
    const ok = resultsFor(events, "web_fetch").filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    expect(ok[0]?.output).toContain("<fetched-content");
  });
});
