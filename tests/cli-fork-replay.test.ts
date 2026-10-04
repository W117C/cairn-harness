// M8 判卷：fork/replay 的纯逻辑（分叉点算术 / 命名 / 回放渲染）+ 真跑 bin 的端到端（离线 demo 通道）。
// 端到端三条主线：
//   · `--replay` 只读：打决策链（含 gate 判定），原日志 sha256 不变；
//   · `--fork`：前缀**逐字节**一致 + `session_meta.branch_of` + 源会话 sha256 不变 + 新会话可续跑；
//   · 「中断后完整可续」的确定性切面：SIGINT 收束（优雅路径）之后，同一条会话继续追加、重放读得到。
// 边界（如实写在判卷里，不假装覆盖）：硬杀（SIGKILL）在 write 半途可能留半写尾行。
// （2026-10-01 晚收口：append 侧已修——`src/events` 的 repairPartialTail 在新开句柄时裁剪半写尾段
// 并响亮告警；本文件的 SIGINT 用例覆盖的是优雅路径，硬杀路径的判卷见 tests/events-tail-repair.test.ts。）
import { spawn, spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEventLog, replay, type AgentEvent } from "../src/events";
import { forkPointOf, forkSessionName, formatReplay } from "../src/agent/fork-cli";
import { isValidSessionName } from "../src/main/sessions";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const BIN = join(ROOT, "bin", "cairn.mjs");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const mkws = (): string => {
  const ws = mkdtempSync(join(tmpdir(), "cairn-fork-"));
  dirs.push(ws);
  return ws;
};
const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

/** 无凭据、无网络的子进程环境（照 tests/cli-exit-code.test.ts 的口径）。 */
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const k of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete env[k];
  return env;
};

/** 两轮会话的种子日志（真事件形状，不经过模型）。 */
async function seedSession(ws: string, id: string, rounds: number): Promise<string> {
  const dir = join(ws, ".agent", "sessions");
  await mkdir(dir, { recursive: true });
  const path = join(dir, id + ".jsonl");
  const log = createEventLog(path);
  for (let r = 1; r <= rounds; r += 1) {
    await log.append({ type: "user_message", content: `第 ${r} 轮任务` } as AgentEvent);
    await log.append({ type: "assistant_message", content: `第 ${r} 轮回复` } as AgentEvent);
    await log.append({ type: "tool_call", id: `c${r}`, name: "read_file", args: { path: "a.ts" } } as AgentEvent);
    await log.append({ type: "tool_result", callId: `c${r}`, ok: true, output: "ok" } as AgentEvent);
  }
  return path;
}

const cli = (ws: string, args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [BIN, "--workspace", ws, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: cleanEnv(),
    input: "",
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

describe("forkPointOf / forkSessionName：分叉点算术与命名（纯函数）", () => {
  const four = (rounds: number): AgentEvent[] => {
    const out: AgentEvent[] = [];
    for (let r = 1; r <= rounds; r += 1) {
      out.push({ type: "user_message", content: `第 ${r} 轮` } as AgentEvent);
      out.push({ type: "assistant_message", content: "…" } as AgentEvent);
      out.push({ type: "tool_call", id: `c${r}`, name: "read_file", args: {} } as AgentEvent);
      out.push({ type: "tool_result", callId: `c${r}`, ok: true, output: "ok" } as AgentEvent);
    }
    return out;
  };

  it("三轮会话：--from 1/2/3 的分叉点 = 第 4/8/12 条（保留前 N 轮含整轮）", () => {
    const events = four(3);
    expect(forkPointOf(events, 1)).toEqual({ lastIncluded: 4, totalRounds: 3 });
    expect(forkPointOf(events, 2)).toEqual({ lastIncluded: 8, totalRounds: 3 });
    expect(forkPointOf(events, 3), "已是最后一轮 ⇒ 保留全量（换会话 id 续跑，语义仍成立）").toEqual({ lastIncluded: 12, totalRounds: 3 });
  });

  it("末轮被中断（轮内只落了半截）⇒ 仍按 user_message 边界算，取到日志尾", () => {
    const events = four(3).slice(0, 9); // 第 3 轮只有 user_message
    expect(forkPointOf(events, 3)).toEqual({ lastIncluded: 9, totalRounds: 3 });
    expect(forkPointOf(events, 2)).toEqual({ lastIncluded: 8, totalRounds: 3 });
  });

  it("轮次越界 / 非正整数 / 空会话：各自点名报错（不静默回落）", () => {
    const events = four(2);
    expect(forkPointOf(events, 0)).toMatchObject({ error: expect.stringContaining("正整数") as unknown as string });
    expect(forkPointOf(events, 1.5)).toMatchObject({ error: expect.stringContaining("正整数") as unknown as string });
    expect(forkPointOf(events, 3)).toMatchObject({ error: expect.stringContaining("超出会话轮数（该会话共 2 轮）") as unknown as string });
    expect(forkPointOf([], 1)).toMatchObject({ error: expect.stringContaining("0 条 user_message") as unknown as string });
  });

  it("新会话名 = <源>-f<轮次>，且必须是合法会话名（同一份校验）", () => {
    expect(forkSessionName("cli-1", 2)).toBe("cli-1-f2");
    expect(isValidSessionName(forkSessionName("cli-1", 2))).toBe(true);
    expect(isValidSessionName(forkSessionName("a".repeat(80), 1)), "80+字符必须被拒（cli 走到这条会报错退出）").toBe(false);
  });
});

describe("formatReplay：决策链渲染（gate 判定/验证/审批/worker diff 各有行）", () => {
  const EVENTS: AgentEvent[] = [
    { type: "session_meta", branch_of: "/tmp/src.jsonl" } as AgentEvent,
    { type: "user_message", content: "把失败的用例修好" } as AgentEvent,
    { type: "assistant_delta", callId: "a1", text: "我先" } as AgentEvent,
    { type: "assistant_delta", callId: "a1", text: "看看" } as AgentEvent,
    { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.ts" } } as AgentEvent,
    { type: "tool_result", callId: "c1", ok: true, output: "120 行", gate: { verdict: "auto-approved", layer: "L3-rule" } } as AgentEvent,
    { type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, cause: "code", results: [] } as AgentEvent,
    {
      type: "tool_result",
      callId: "diff-worker-1",
      ok: true,
      output: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n",
    } as AgentEvent,
    { type: "approval_requested", id: "apr-1", agent_id: "w1", tool: "spawn_agent", args_digest: "x", risk: "high" } as AgentEvent,
    { type: "approval_resolved", id: "apr-1", agent_id: "w1", decision: "approved", scope: "once" } as AgentEvent,
  ];

  it("delta 合并成一行（真 provider 只发 delta——不合并则正文丢失），且只在首次出现处打", () => {
    const text = formatReplay(EVENTS);
    const lines = text.split("\n").filter((l) => l.includes("assistant_delta"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("我先看看");
  });

  it("tool_result 带 gate 判定；verify 带 cause；审批对出两行", () => {
    const text = formatReplay(EVENTS);
    expect(text).toContain("[auto-approved·L3-rule]");
    expect(text).toContain("验证 失败（第 1/3 拍） cause=code");
    expect(text).toContain("apr-1 w1 请求 spawn_agent（风险 high）");
    expect(text).toContain("apr-1 w1 → approved（once）");
  });

  it("worker diff 压成形状行（文件数/hunk/± 行），整块 patch 不进回放", () => {
    const text = formatReplay(EVENTS);
    expect(text).toContain("worker diff：1 文件 / 1 hunk / +1 −1 行");
    expect(text).not.toContain("diff --git a/a.ts");
  });

  it("未知类型不静默丢（回放里看不见 = 没有）", () => {
    const text = formatReplay([{ type: "routing_decision", foo: 1 } as unknown as AgentEvent]);
    expect(text).toContain("routing_decision");
    expect(text).toContain("本行不做摘要");
  });
});

describe("真跑 bin：--replay 只读 / --fork 不污染原历史 / 中断后可续（离线 demo）", () => {
  it("--replay：打决策链（#N 序号 + 任务行），退出 0，日志 sha256 不变", async () => {
    const ws = mkws();
    const path = await seedSession(ws, "seed1", 2);
    const before = sha(path);
    const r = cli(ws, ["--replay", "seed1"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("#1 user_message 任务：第 1 轮任务");
    expect(r.stdout).toContain("#2 assistant_message 第 1 轮回复");
    expect(r.stdout).toContain("（8 条事件）");
    expect(sha(path), "回放不改日志").toBe(before);
  });

  it("--replay 不存在的会话 ⇒ exit 1 且点名（不当成用法错，也不静默 0）", async () => {
    const ws = mkws();
    const r = cli(ws, ["--replay", "nope"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("会话不存在：nope");
  });

  it("--fork：前缀逐字节一致 + session_meta.branch_of + 源会话 sha256 不变 + 新会话继续追加", async () => {
    const ws = mkws();
    const src = await seedSession(ws, "seed2", 2);
    const srcBefore = sha(src);
    const point = forkPointOf(await replay(src), 1) as { lastIncluded: number };
    const r = cli(ws, ["--provider", "demo", "--mode", "auto", "--fork", "seed2", "--from", "1", "换条路重跑"]);
    expect([0, 1], "demo 剧本里有失败工具调用 ⇒ 允许 exit 1；2 是用法错，不许").toContain(r.status);
    expect(r.stderr).toContain("已分叉：seed2 前 1 轮");
    const target = join(ws, ".agent", "sessions", "seed2-f1.jsonl");
    expect(existsSync(target), "新会话文件必须落在 sessions/<id>-f<轮>.jsonl").toBe(true);
    expect(sha(src), "源会话只读：sha256 逐字节不变").toBe(srcBefore);
    // 前缀逐字节：新日志前 lastIncluded 行 == 源日志前 lastIncluded 行
    const srcLines = readFileSync(src, "utf8").split("\n");
    const newLines = readFileSync(target, "utf8").split("\n");
    expect(newLines.slice(0, point.lastIncluded)).toEqual(srcLines.slice(0, point.lastIncluded));
    expect(newLines[point.lastIncluded]).toContain('"session_meta"');
    expect(newLines[point.lastIncluded]).toContain("branch_of");
    expect(newLines.length, "分叉后必须还有新跑的事件（新任务已作为第 2 轮跑上去）").toBeGreaterThan(point.lastIncluded + 2);
    // 续跑：接着新会话再跑一轮，源会话仍不变
    const r2 = cli(ws, ["--provider", "demo", "--mode", "auto", "--session", "seed2-f1", "再来一轮"]);
    expect([0, 1]).toContain(r2.status);
    const grown = readFileSync(target, "utf8");
    expect(grown).toContain("再来一轮");
    expect(sha(src), "续跑分叉会话，源会话仍逐字节不变").toBe(srcBefore);
  });

  it("--fork 的用法闸：轮次越界 exit 2；目标已存在 exit 2（不覆盖既有转录）", async () => {
    const ws = mkws();
    await seedSession(ws, "seed3", 2);
    const bad = cli(ws, ["--provider", "demo", "--mode", "auto", "--fork", "seed3", "--from", "9", "x"]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("超出会话轮数");
    const first = cli(ws, ["--provider", "demo", "--mode", "auto", "--fork", "seed3", "--from", "2", "先占住"]);
    expect([0, 1]).toContain(first.status);
    const again = cli(ws, ["--provider", "demo", "--mode", "auto", "--fork", "seed3", "--from", "2", "再占一次"]);
    expect(again.status).toBe(2);
    expect(again.stderr).toContain("目标会话已存在");
  });

  it("中断后完整可续：SIGINT 收束后，同一条会话继续追加、重放读得到", async () => {
    const ws = mkws();
    await seedSession(ws, "seed4", 1);
    const logPath = join(ws, ".agent", "sessions", "seed4.jsonl");
    const child = spawn(process.execPath, [BIN, "--workspace", ws, "--provider", "demo", "--mode", "auto", "--session", "seed4", "先跑起来"], {
      cwd: ROOT,
      env: cleanEnv(),
      stdio: "ignore",
    });
    const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
    // 等日志长起来再发 Ctrl-C（demo 可能已经跑完——两种情形下断言都必须成立）
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      if (existsSync(logPath) && readFileSync(logPath, "utf8").includes("先跑起来")) break;
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    if (child.exitCode === null) child.kill("SIGINT");
    await exited;
    // 收束后日志必须可读（尾部半写行按既有降级容错跳过；mid 坏行会抛——那才是真断裂）
    const afterInterrupt = await replay(logPath);
    expect(afterInterrupt.length).toBeGreaterThan(0);
    // 续跑：照常追加，且新的一轮在重放里读得到
    const r = cli(ws, ["--provider", "demo", "--mode", "auto", "--session", "seed4", "接着来"]);
    expect([0, 1]).toContain(r.status);
    const finalEvents = await replay(logPath);
    expect(finalEvents.some((e) => e.type === "user_message" && e.content === "接着来")).toBe(true);
    const trace = formatReplay(finalEvents);
    expect(trace).toContain("任务：接着来");
  }, 120_000);
});
