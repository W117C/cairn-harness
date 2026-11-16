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
import { WORKTREE_ROOT_DIR } from "../src/agent/worktree";
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
    // 现场快照要在 injectComment 之前取：树本来在不在都行，要钉的是「这次调用没动它」。
    // 旧写法 `existsSync(join(repo,"worktrees",...)) === false || true` 有两处病：
    //   ① `|| true` 把条件钉成恒真，整条断言是空的；
    //   ② 路径本身也错了——真实树在 `.agents/wt-<id>`（WORKTREE_ROOT_DIR），`worktrees/` 永不出现。
    // 两处一起修，才让这一格能红：目录被这次调用造出来或被删掉，前后快照就不同。
    const tree = join(repo, WORKTREE_ROOT_DIR, "wt-" + id);
    const treeBefore = existsSync(tree);
    const r = await orch.injectComment(id, "a.ts", 1, "这里改成两行");
    expect(r.injected).toBe(false);
    expect(r.error).toContain("主会话已取消");
    // 没有重启：终态维持（injectComment 之后无新的 running 状态、agent_result 仍只有一条）
    expect(events.slice(before).some((e) => e.type === "agent_status" && e.status === "running")).toBe(false);
    expect(events.filter((e) => e.type === "agent_result" && e.agent_id === id)).toHaveLength(1);
    expect(existsSync(tree), "被拒的重启改动了现场：`" + tree + "` 的存在性前后不一致").toBe(treeBefore);
  }, 60_000);
});
