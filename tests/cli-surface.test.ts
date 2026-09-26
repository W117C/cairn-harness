// m0 CLI 的产品面契约（§阶段 B）。
//
// 这组只钉**从外面能观测到的东西**：退出码、stderr 上可操作的提示、落盘的日志。
// 渲染器 `renderEvent` 是纯函数，直接单测；审批门的接线用结构断言 + 真跑一次非交互路径。
//
// 刻意不做的：不 mock `runAgent` 去测「模型跑得好不好」——那是 e2e 的活（scripts/e2e.ts）。
// 这里钉的是「没人能用」这个缺陷本身：没有 bin、没有 README、没有可执行的产品面。
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEvent } from "../src/cli";
import type { AgentEvent } from "../src/events";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const BIN = join(ROOT, "bin", "m0.mjs");

/** 真跑 CLI。`noKeys` 抹掉全部 provider key，让 provider 推断走「一个都没配」那一支。 */
function runCli(args: string[], opts: { noKeys?: boolean } = {}): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  if (opts.noKeys !== false) {
    for (const k of ["M0_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete env[k];
    delete env.M0A_PROVIDER;
  }
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: "utf8", env, input: "" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("m0 CLI：产品面存在且可执行", () => {
  it("bin/m0.mjs 在盘上且带 shebang（npm bin 的硬要求）", () => {
    expect(existsSync(BIN)).toBe(true);
    expect(readFileSync(BIN, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("package.json 的 bin 指向它（装上才有 m0 这个命令）", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { bin?: Record<string, string> };
    expect(pkg.bin?.m0).toBe("./bin/m0.mjs");
  });

  it("真跑：--help 打印用法并 exit 0（走真 bin shim，不是 import src）", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("用法：");
    expect(r.out).toContain("--mode");
  });
});

describe("m0 CLI：退出码 0 / 1 / 2（照 scripts/gym-run.ts 的口径）", () => {
  it("缺任务描述 ⇒ exit 2 且说清怎么用", () => {
    const r = runCli([]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("任务描述");
  });

  it("flag 给了却没带值 ⇒ exit 2（静默按缺省跑会让打错的 flag 假装生效）", () => {
    const r = runCli(["--mode"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--mode 需要一个值");
  });

  it("未知 --mode ⇒ exit 2 且列出合法档位", () => {
    const r = runCli(["--mode", "bogus", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("未知 --mode");
    expect(r.out).toContain("read-only");
  });

  it("位置参数超过两个 ⇒ exit 2（不猜哪个是工作区）", () => {
    const r = runCli(["a", "b", "c"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("位置参数最多两个");
  });
});

describe("m0 CLI：缺 key 时 fail-closed，不静默换一家也不落 demo", () => {
  it("一个 key 都没配 ⇒ exit 2，且**没有**默默跑 demo", () => {
    const r = runCli(["做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("没有配置任何 provider 的 API key");
    // 关键：不能出现「跑完了」这类仿佛真跑过的输出，也不能说自己在 demo 档
    expect(r.out).not.toContain("事件日志：");
  });

  it("提示里点名了要设哪个环境变量，含 DeepSeek 那条 OpenAI 兼容通道", () => {
    const r = runCli(["做点事"]);
    expect(r.out).toContain("M0_API_KEY");
    expect(r.out).toContain("OPENAI_BASE_URL=https://api.deepseek.com/v1");
  });

  it("配置错不打「用法」行（那行会把人引到 argv 上去，而该配的是环境变量）", () => {
    expect(runCli(["做点事"]).out).not.toContain("用法：m0");
  });
});

describe("m0 CLI：默认档位是 fail-closed 的那一档", () => {
  it("源码里默认档是 default 而不是 auto（auto 必须显式 opt-in）", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    expect(src).toContain('pick("--mode") ?? "default"');
    expect(src).not.toContain('pick("--mode") ?? "auto"');
  });

  it("启动时自检沙箱，不可用就明说（不假装有沙箱）", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    expect(src).toContain("checkSandbox()");
    expect(src).toContain("沙箱不可用");
  });

  it("退出时收掉 tracked 子进程（killAllTrackedChildren 的天然调用方就是这里）", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    expect(src).toContain("killAllTrackedChildren");
  });
});

describe("m0 CLI：审批门在没人能答时 fail-closed", () => {
  // 这条钉的是实测过的真缺陷：stdin 非 TTY 时 createInterface 立刻 EOF，
  // rl.question 随后**抛异常**，那个 throw 从 notify 冒进工具执行里，
  // 被 loop 记成「工具失败：readline was closed」——一次没人应答的审批，
  // 在日志里伪装成模型写盘失败。
  it("stdin 非 TTY 时门按 unattended 收束，不等那个 60s 超时", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    expect(src).toContain("process.stdin.isTTY === true");
    expect(src).toContain("unattended: opts.unattended || !interactive");
  });

  it("rl.question 的 throw 被吞掉并转成拒绝（不许冒进工具执行）", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    // 边界用代码标识而不是注释文字（`tests/assertion-health-scan.test.ts` 那条棘轮管这个）。
    // 两个位置还要显式核：`indexOf` 找不到返回 -1，slice 会静默少截一段——断言于是变成"少看一段仍绿"。
    const from = src.indexOf("function promptForApproval");
    const to = src.indexOf("function printHelp");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    const fn = src.slice(from, to);
    expect(fn).toMatch(/try\s*\{[\s\S]*rl\.question\([\s\S]*\}\s*catch\s*\{/);
    expect(fn).toContain("gate.decide(req.askId, false");
  });
});

describe("renderEvent：事件 → stdout（全仓第一份渲染器）", () => {
  const ev = (e: Partial<AgentEvent>): AgentEvent => e as AgentEvent;

  it("工具调用带名字与参数摘要（write_file 只报路径，不刷正文）", () => {
    const line = renderEvent(ev({ type: "tool_call", id: "c1", name: "write_file", args: { path: "src/a.ts", content: "很长的正文".repeat(50) } }));
    expect(line).toContain("write_file");
    expect(line).toContain("src/a.ts");
    expect(line).not.toContain("很长的正文");
  });

  it("run_shell 的参数摘要取命令首行", () => {
    const line = renderEvent(ev({ type: "tool_call", id: "c1", name: "run_shell", args: { command: "pnpm test\n--reporter=verbose" } }));
    expect(line).toContain("pnpm test");
    expect(line).not.toContain("reporter=verbose");
  });

  it("成功 / 失败分色可辨（NO_COLOR 下也靠 ✓ / ✗ 区分）", () => {
    expect(renderEvent(ev({ type: "tool_result", callId: "c1", ok: true, output: "done" }))).toContain("✓");
    expect(renderEvent(ev({ type: "tool_result", callId: "c1", ok: false, output: "boom" }))).toContain("✗");
  });

  it("多行输出压成首行（整块刷屏反而看不见发生了什么）", () => {
    const line = renderEvent(ev({ type: "tool_result", callId: "c1", ok: true, output: "\n\n真正的第一行\n后面还有一百行" }));
    expect(line).toContain("真正的第一行");
    expect(line).not.toContain("后面还有一百行");
  });

  it("空 assistant_message 不打空行", () => {
    expect(renderEvent(ev({ type: "assistant_message", content: "" }))).toBeNull();
  });

  it("不进 stdout 的事件返回 null（它们在 JSONL 里，需要时 replay）", () => {
    expect(renderEvent(ev({ type: "session_meta" }))).toBeNull();
  });
});
