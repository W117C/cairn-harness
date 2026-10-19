// 退出码判据（2026-09-29）：README 把 1 定义成「跑完了但有失败（工具失败 / 验证红 / provider 报错）」，
// 而此前 `cli.ts` 只在 `error` 事件与 verify 红时置 1 —— **工具被门拒掉时退出码仍是 0**。
//
// 实测两例（本轮动因，两例都是「失败被报成成功」）：
//   ① `--mode default` 在管道里：写盘被方案门拒、工作区一个字节没动、退出码 0，
//      终端台词还是「任务完成」；
//   ② demo 通道：`read_file` 与 `run_shell` 都 ok=false，退出码 0。
// 任何把 cairn 接进脚本 / CI 的人，都会把这两例读成成功。
//
// 这组钉两半：
//   A. `runFailed` 纯函数五个输入的边界（含**反向对照**：全 0 必须不判红，
//      否则「退出码变严」会退化成「永远 exit 1」，那是另一种骗人）；
//   B. 真跑 bin（demo 通道，零凭据、离线、确定性）断言真实退出码，而不是只测纯函数。
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFailed } from "../src/cli";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const BIN = join(ROOT, "bin", "cairn.mjs");

/** 五个计数器全零 = 这一轮什么都没出错 ⇒ 必须放行。 */
const CLEAN = { errorEvents: 0, verifyRed: false, gateBlocks: 0, deniedPlans: 0, plainToolFailures: 0 };

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function runAgentCli(
  scriptLines: Record<string, unknown>[],
  args: string[] = [],
  extraEnv: Record<string, string> = {},
  prepareWorkspace?: (workspace: string) => Record<string, string>,
  message: string = "执行任务",
): { status: number | null; output: string; workspace: string; events: Record<string, unknown>[] } {
  const workspace = mkdtempSync(join(tmpdir(), "cairn-delivery-"));
  dirs.push(workspace);
  const script = join(workspace, "main.jsonl");
  writeFileSync(script, scriptLines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  const prepared = prepareWorkspace?.(workspace) ?? {};

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    M3A_MAIN_SCRIPT: script,
    ...extraEnv,
    ...prepared,
  };
  for (const key of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "M0A_PROVIDER"]) {
    if (!(key in extraEnv)) delete env[key];
  }
  if (!("M0A_MOCK_DELTA" in extraEnv)) delete env.M0A_MOCK_DELTA;

  const r = spawnSync(
    process.execPath,
    [BIN, "--provider", "demo", "--mode", "auto", "--unattended", "--workspace", workspace, ...args, message],
    { cwd: ROOT, encoding: "utf8", env, input: "", timeout: 120_000, killSignal: "SIGKILL" },
  );
  const sessionDir = join(workspace, ".agent", "sessions");
  const logName = readdirSync(sessionDir)[0] ?? "";
  const events = readFileSync(join(sessionDir, logName), "utf8")
    .trim().split("\n").filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    status: r.status,
    output: (r.stdout ?? "") + (r.stderr ?? ""),
    workspace,
    events,
  };
}

const PLAN_ONLY = [
  {
    type: "tool_call",
    id: "p1",
    name: "propose_plan",
    args: { goal: "创建 a.html", files: [{ action: "create", path: "a.html", summary: "页面" }] },
  },
  { type: "round_end" },
  { type: "assistant_message", content: "已完成" },
];

const PLAN_THEN_WRITE = [
  ...PLAN_ONLY,
  { type: "round_end" },
  {
    type: "tool_call",
    id: "w1",
    name: "write_file",
    args: { path: "a.html", content: "<h1>ok</h1>\n" },
  },
  { type: "round_end" },
  { type: "assistant_message", content: "这次真的写好了" },
];

describe("runFailed：退出码判据（纯函数，五个输入各自能单独判红）", () => {
  it("全零 ⇒ 不判红（反向对照：判据不是恒真的）", () => {
    expect(runFailed(CLEAN)).toBe(false);
  });

  it("error 事件 ≥1 ⇒ 判红", () => {
    expect(runFailed({ ...CLEAN, errorEvents: 1 })).toBe(true);
  });

  it("verify 红 ⇒ 判红", () => {
    expect(runFailed({ ...CLEAN, verifyRed: true })).toBe(true);
  });

  it("门拒绝留痕 ≥1 ⇒ 判红（这是本轮补上的那一格）", () => {
    expect(runFailed({ ...CLEAN, gateBlocks: 1 })).toBe(true);
  });

  it("方案被拒 ≥1 ⇒ 判红（写禁没解除 = 这一轮没真正开工）", () => {
    expect(runFailed({ ...CLEAN, deniedPlans: 1 })).toBe(true);
  });

  it("普通工具失败 ≥1 ⇒ 判红（demo 通道那两个 ok=false 就走这一格）", () => {
    expect(runFailed({ ...CLEAN, plainToolFailures: 1 })).toBe(true);
  });

  it("五项各自单独命中都要判红（不许有哪一项被写成死代码）", () => {
    const each = [
      { ...CLEAN, errorEvents: 2 },
      { ...CLEAN, verifyRed: true },
      { ...CLEAN, gateBlocks: 3 },
      { ...CLEAN, deniedPlans: 1 },
      { ...CLEAN, plainToolFailures: 5 },
      { ...CLEAN, deliveryFailure: true },
    ];
    for (const input of each) expect(runFailed(input)).toBe(true);
  });

  // 能力 12（2026-10-17）：交付失败是**唯一一项「跑完了、没报错、但产物不在」的失败**。
  // 实测 11 趟鹈鹕跑分里 8 趟交付了不存在的文件，而退码 0 ⇒ 「说了没做」与「做成了」
  // 在 CI 上同形。这一格把它接进退码。
  it("交付失败 ⇒ 判红（承诺要造的文件没落盘或真正空输出）", () => {
    expect(runFailed({ ...CLEAN, deliveryFailure: true })).toBe(true);
  });

  it("交付失败缺席 ⇒ 不判红（缺字段 = 没这回事，不是恒红）", () => {
    expect(runFailed({ ...CLEAN })).toBe(false);
    expect(runFailed({ ...CLEAN, deliveryFailure: false })).toBe(false);
  });
});

describe("真跑 bin：demo 通道的退出码（零凭据、离线、确定性）", () => {
  it("剧本里有失败的工具调用 ⇒ exit 1，不再报成成功", () => {
    const ws = mkdtempSync(join(tmpdir(), "cairn-exitcode-"));
    dirs.push(ws);
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
    for (const k of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete env[k];
    const r = spawnSync(process.execPath, [BIN, "--provider", "demo", "--mode", "auto", "--workspace", ws, "任意任务"], {
      cwd: ROOT,
      encoding: "utf8",
      env,
      input: "",
      timeout: 120_000,
      killSignal: "SIGKILL",
    });
    // 断言的是**退出码与事件流一致**：先数事件流里到底有没有失败面，
    // 再由它决定期望值——写死 1 会在剧本改成全成功时误报红（那是判据脆，不是代码错）。
    const sessionDir = join(ws, ".agent", "sessions");
    const logName = spawnSync("ls", [sessionDir], { encoding: "utf8" }).stdout.trim().split("\n")[0] ?? "";
    expect(logName).not.toBe("");
    const events = spawnSync("cat", [join(sessionDir, logName)], { encoding: "utf8" }).stdout
      .trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
    const failedTools = events.filter((e) => e["type"] === "tool_result" && e["ok"] === false
      // 会话末沉淀轮不算（X- 层）：它在管道里本来就会被拒
      && ((e["gate"] as { layer?: string } | undefined)?.layer ?? "").startsWith("X-") === false);
    if (failedTools.length > 0) {
      expect(r.status, "剧本里有失败工具调用，退出码必须是 1").toBe(1);
    } else {
      expect(r.status).toBe(0);
    }
  }, 180_000);

  it("CLI 已落交付红时仍按最终文件状态 exit 1", () => {
    const r = runAgentCli(PLAN_ONLY);
    expect(r.status).toBe(1);
    expect(r.output).toContain("[delivery]");
    expect(r.events.filter((e) => e["type"] === "tool_result" && e["callId"] === "harness-delivery-guard")).toHaveLength(1);
    expect(existsSync(join(r.workspace, "a.html"))).toBe(false);
  }, 180_000);

  it("--delivery-repair 从 CLI 穿到 runner：补写真实文件后 exit 0", () => {
    const r = runAgentCli(PLAN_THEN_WRITE, ["--delivery-repair"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(r.workspace, "a.html")), "返修开关没传到 runLoop ⇒ 没有第二笔真实写盘").toBe(true);
    expect(readFileSync(join(r.workspace, "a.html"), "utf8")).toBe("<h1>ok</h1>\n");
  }, 180_000);

  it("默认路径下零输出零工具也落交付告警并 exit 1", () => {
    const r = runAgentCli([]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("[delivery] 这一轮没有工具调用");
    expect(r.events.filter((e) => e["type"] === "tool_result" && e["callId"] === "harness-delivery-guard")).toHaveLength(1);
  }, 180_000);

  it("正常流式正文不被误判为空转", () => {
    const r = runAgentCli([{ type: "assistant_message", content: "这是完整回答" }], [], { M0A_MOCK_DELTA: "1" });
    expect(r.events.some((e) => e["type"] === "assistant_delta"), "流式通道没有真的启用").toBe(true);
    expect(r.output).not.toContain("[delivery] 这一轮没有工具调用");
    expect(r.status).toBe(0);
  }, 180_000);

  it("UserPromptSubmit 阻断 ⇒ 落结构化失败并 exit 1", () => {
    const r = runAgentCli([], [], {}, (workspace) => {
      const root = join(workspace, "plugins", "cli-hook-demo");
      writeFileSync(join(workspace, "block-hook.cjs"),
        "process.stderr.write('blocked by cli hook'); process.exit(2);\n", "utf8");
      mkdirSync(join(root, ".claude-plugin"), { recursive: true });
      mkdirSync(join(root, "hooks"), { recursive: true });
      writeFileSync(join(root, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "cli-hook-demo", description: "CLI 阻断判据", version: "0.1.0" }), "utf8");
      writeFileSync(join(root, "hooks", "hooks.json"), JSON.stringify({
        hooks: {
          UserPromptSubmit: [{
            hooks: [{ type: "command", command: 'node "' + join(workspace, "block-hook.cjs") + '"' }],
          }],
        },
      }), "utf8");
      return {
        M2E_USER_PLUGINS: join(workspace, "plugins"),
        M2E_PLUGIN_DATA: join(workspace, "plugin-data"),
      };
    });
    expect(r.status).toBe(1);
    expect(r.output).toContain("blocked by cli hook");
    expect(r.events.some((e) => e["type"] === "error"
      && String(e["message"]).includes("UserPromptSubmit"))).toBe(true);
  }, 180_000);

  it("user-invocable:false 命令拒绝 ⇒ 落结构化失败并 exit 1", () => {
    const r = runAgentCli([], [], {}, (workspace) => {
      const root = join(workspace, "plugins", "cli-command-demo");
      mkdirSync(join(root, ".claude-plugin"), { recursive: true });
      mkdirSync(join(root, "commands"), { recursive: true });
      writeFileSync(join(root, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "cli-command-demo", description: "CLI 命令拒绝判据", version: "0.1.0" }), "utf8");
      writeFileSync(join(root, "commands", "quiet.md"),
        "---\ndescription: 不可用户调用\nuser-invocable: false\n---\n不该执行\n", "utf8");
      return {
        M2E_USER_PLUGINS: join(workspace, "plugins"),
        M2E_PLUGIN_DATA: join(workspace, "plugin-data"),
      };
    }, "/cli-command-demo:quiet");
    expect(r.status).toBe(1);
    expect(r.output).toContain("不可用户调用");
    expect(r.events.some((e) => e["type"] === "error"
      && String(e["message"]).includes("不可用户调用"))).toBe(true);
  }, 180_000);
});
