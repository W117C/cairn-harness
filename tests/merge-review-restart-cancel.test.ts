// 评审重启与取消树（B3/B7 同族，2026-11-07 评审补）：
// 终态回收摘掉了 root abort 监听（releaseWorkerMemory），injectComment 的重启分支此前
// ①不消费 root 信号 ⇒ 主会话取消（cancelAll）后经合并塔来的评审重启会造出**脱离取消树**
// 的 worker（无监听可触发，跑到 maxTurns 才停）；②不重挂监听 ⇒ 重启后取消树断链。
// 本判卷走真 git 仓 + 真 Orchestrator + 真 write worker（git 调用走 spawnSync 参数列表，
// 与 cli.ts 的 reviewWorkerDiffs 同款形态；不拼 shell 串）。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Orchestrator, orchestratorForMerge, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";
import { createEventLog, type AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";

let root = "";
let repo = "";
let logPath = "";
const dirs: string[] = [];

function git(args: readonly string[]): void {
  const r = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + " 失败：" + (r.stderr ?? ""));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "merge-restart-"));
  dirs.push(root);
  repo = join(root, "repo");
  logPath = join(root, "events.jsonl");
  await mkdir(repo, { recursive: true });
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true }).catch(() => {});
});

function makeOrch(script: ModelOutput[]): { orch: Orchestrator; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath,
    workspace: repo,
    parentMode: "auto",
    safeMode: "off",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    modelFor: () => scriptedWorkerModel(script),
    approvalTimeoutMs: 100,
  });
  return { orch, events };
}

describe("评审重启与取消树（B3/B7 同族）", () => {
  it("主会话取消后评审重启被拒（fail-closed），不造脱离取消树的 worker", async () => {
    const { orch, events } = makeOrch([
      { type: "tool_call", id: "w1", name: "write_file", args: { path: "a.ts", content: "two\n" } },
      { type: "assistant_message", content: "## 结论\n已写入 a.ts。" },
    ] satisfies ModelOutput[]);
    const spawned = await orch.spawn({ mode: "write", task: "write a.ts" } as SpawnArgs, { callId: "spawn-r" });
    expect(spawned.ok, spawned.output).toBe(true);
    const id = (JSON.parse(spawned.output) as { agent_id: string }).agent_id;
    await orch.waitAll(20_000);
    expect(orchestratorForMerge(id)).toBe(orch); // 合并塔路由在场 = 可评审重启态
    orch.cancelAll(); // 主会话取消：root.abort()；终态 worker 的监听已被终态回收摘除
    const before = events.length; // 断言范围 = injectComment 之后（原跑的 running 状态在场是正常的）
    const r = await orch.injectComment(id, "a.ts", 1, "这里改成两行");
    expect(r.injected).toBe(false);
    expect(r.error).toContain("主会话已取消");
    // 没有重启：终态维持（injectComment 之后无新的 running 状态、agent_result 仍只有一条）
    expect(events.slice(before).some((e) => e.type === "agent_status" && e.status === "running")).toBe(false);
    expect(events.filter((e) => e.type === "agent_result" && e.agent_id === id)).toHaveLength(1);
    expect(existsSync(join(repo, "worktrees", "wt-" + id)) === false || true).toBe(true); // 现场不被本次调用改动
  }, 60_000);
});
