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
import { mkdtempSync, rmSync } from "node:fs";
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
    ];
    for (const input of each) expect(runFailed(input)).toBe(true);
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
});
