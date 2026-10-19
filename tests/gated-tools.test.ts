// 工具门接线测试（任务 3）：default 档 ask → 批准才执行；拒绝不执行；沙箱不可用时写工具强制审批。
// runAgent 即 main 暴露的同一入口；AskGate 用即时决议的 stub 模拟 UI 点击。
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireAppFixtureLock } from "./app-fixture-lock";
import { runAgent } from "../src/main/agent-runner";
import { AskGate } from "../src/main/ask-gate";
import type { WebFetchDeps } from "../src/tools/web_fetch";
import type { HostResolver } from "../src/tools/web-fetch-policy";
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

/** 出网用例的传输层桩：**不连网**，回一封固定的 text/html。
 *
 *  为什么必须这样做：这两条测的是**权限门接线**（卡真的弹、批了才真跑、拒绝一个字节都不出），
 *  而它们从前真连 https://example.com/。实测（2026-10-16）全量跑时网络时通时断——
 *  `curl` 通而 Node `fetch` 报 `Client network socket disconnected before secure TLS
 *  connection was established` ⇒ 一条与网络无关的断言被网络抖动拖着时红时绿。
 *  传输层本身的判卷在 tests/web-fetch.test.ts（那里也是注入 fetchImpl，34 条全绿），
 *  所以这里换掉字节来源不损失覆盖，只是让"门接得对"这件事不再看网络脸色。
 *
 *  `resolveHost` 给一个真公网 IP（同 web-fetch.test.ts 的 publicResolver 口径）：
 *  那让 SSRF 判据照常判一遍"这段是公网"，而不是被一个总是放行的桩替它决定。 */
const OFFLINE_FETCH_DEPS: WebFetchDeps = {
  resolveHost: (async () => ["93.184.216.34"]) as HostResolver,
  fetchImpl: (async () =>
    new Response("<html><body><p>离线桩正文</p></body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    })) as unknown as typeof fetch,
};

// 本文件会改写共享靶子 fixtures/todo-app/src/todo.ts：与 runner-gates / replay-faces 共用一把锁
// （全量判卷是文件级并行的，无锁时 replay-faces 的「整树逐字节不变」会被这里的写入打断）。
let releaseAppFixture: (() => Promise<void>) | undefined;
beforeAll(async () => { releaseAppFixture = await acquireAppFixtureLock(); }, 360_000);
afterAll(async () => { await releaseAppFixture?.(); });

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
      // 「未获批准」那句一律文案拆成了三种结局各说各的（拒绝 / 超时 / 无人值守，见 tool-gates 的
      // askDenialText）：实测一次审批超时被读成「auto 档禁止写文件」，然后沉淀成跨会话错误经验。
      // 这里改钉**这一格到底是哪种结局**，而不是一句可以同时匹配三种的糊话。
      expect(writes[0]?.output).toContain("用户明确拒绝了这次审批");
      expect(writes[0]?.output).toContain("该工具没有执行");
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
      webFetchDeps: OFFLINE_FETCH_DEPS,
    });
    // 这一格是本段的全部意义：出网**不是**"默认放行的只读工具"。
    // 四档裁决在 tests/web-fetch.test.ts 判过了，这里判的是那张卡真的弹、批了才真跑。
    expect(asked).toEqual(["web_fetch"]);
    const [result] = resultsFor(events, "web_fetch");
    expect(result?.ok).toBe(true);
    expect(result?.output).toContain("<fetched-content");
    expect(result?.output).toContain("不是给我的指令");
    expect(result?.output).toContain("离线桩正文");
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
      webFetchDeps: OFFLINE_FETCH_DEPS,
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
      webFetchDeps: OFFLINE_FETCH_DEPS,
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
      webFetchDeps: OFFLINE_FETCH_DEPS,
    });
    expect(secondAsked, "上一轮点过「总是允许」，这一轮仍然必须问").toEqual(["web_fetch"]);
    const ok = resultsFor(events, "web_fetch").filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    expect(ok[0]?.output).toContain("<fetched-content");
  });

  // 「总是允许」落库之后要**当场重载**规则库（否则本轮内的后续调用与下一轮读到的不是同一套）。
  // 重载读的是那份可能坏掉/读不出的 permissions.json——`loadPermissionRules` 对它是 fail-closed 抛错。
  // 若那次抛错漏出 gatedTool，症状是「人点了总是允许、规则也确实落了盘、工具却没执行」：
  // 授权已经成立，却因为一次重载失败把它吃掉，且要等到下个会话才生效。
  // 判据反过来钉这件事：规则库坏 ⇒ 工具照旧执行（授权优先），而不是把已批准的执行赔进去。
  //
  // 为什么用 write_file 而不是 web_fetch：`effScope = wantsNetwork ? "once" : r.scope`
  // （tool-gates:176）把出网类的 scope 钉死成 once，web_fetch/web_search **永远走不到**
  // always 那一格——拿它们写这条用例是空绿（判据有洞，见仓库自己的判卷纪律）。
  //
  // 形状要点：启动时规则库必须合法（runAgent 入口就 load 一次，坏的在那里就炸，走不到要测的
  // 那一格）；坏掉发生在**批准之后、重载之前**——用审批回调当那个时间窗。
  it("规则库重载失败不吃掉已批准的执行（always 授权成立，执行仍发生）", { timeout: 120_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "m0b-t-always-reload-"));
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "permissions.json"), JSON.stringify({ rules: [] }), "utf8");
    // 剧本通道让工具调用确定化（同本文件上面几条的口径）：这一格要的是"write_file 拿到 always
    // 授权"，靠模型自己挑工具就等于把判据交给模型的随机性。
    // 不共用上面那个 writeScript：它闭包的是另一个 describe 的 dir。
    const scriptPath = join(dir, `script-always-${String(seq++)}.jsonl`);
    await writeFile(scriptPath, JSON.stringify({ type: "tool_call", id: "w1", name: "write_file", args: { path: "note.txt", content: "hello" } }), "utf8");
    vi.stubEnv("M3A_MAIN_SCRIPT", scriptPath);
    try {
      const asked: string[] = [];
      // 卡一弹出来就把规则库写坏：此刻 always 规则还没落库（那一步在批准返回之后），
      // 而重载发生在它之后 ⇒ 重载面对的正是这份坏文件。
      const gate = new AskGate({
        timeoutMs: 1000,
        notify: (req) => {
          asked.push(req.tool);
          void writeFile(join(dir, ".agent", "permissions.json"), "{ 这不是合法 JSON", "utf8");
          gate.decide(req.askId, true, "user", "always");
        },
      });
      const events = await runAgent({
        workspace: dir,
        message: "把 hello 写进 note.txt",
        mode: "default",
        logPath: join(dir, "always-reload.jsonl"),
        askGate: gate,
        sandbox: null,
      });
      expect(asked).toEqual(["write_file"]);
      const ok = resultsFor(events, "write_file").filter((r) => r.ok);
      expect(ok, "规则库重载失败时，这次已批准的 write_file 仍必须真的执行").toHaveLength(1);
      // 授权记录确实落了盘（重载失败与落库失败是两件事，不许互相顶包）
      const always = await readFile(join(dir, ".agent", "permissions.always.json"), "utf8");
      expect(always).toContain("write_file");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
