// #31：worker diff 读取失败不许被吞成「空 diff」。
//
// 旧实现 `worktreeDiff(...).catch(() => null)` 之后仍以 done 收束：files_changed=[]、
// 安全 diff 扫描整段跳过、diff 收据一条不落，而 supervise 的 accept 分支还会据此把
// 真实写出的 worktree 清掉。本判卷走真 git 仓 + 真 Orchestrator + 真 write worker，
// 只在 worktreeDiff 一处打桩抛错，量收束面与盘上现场是否都按 failed 保住。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator, orchestratorForMerge, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";
import { worktreePathFor } from "../src/agent/worktree";
import { createEventLog, type AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";

const diffStub = vi.hoisted(() => ({ fail: true, calls: 0 }));
vi.mock("../src/agent/worktree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/agent/worktree")>();
  return {
    ...actual,
    worktreeDiff: (async (..._args: unknown[]) => {
      diffStub.calls++;
      if (diffStub.fail) throw new Error("git index.lock: diff 读取失败");
      return { stat: "", patch: "", files: [] };
    }) as typeof actual.worktreeDiff,
  };
});

let root = "";
let repo = "";
let logPath = "";
const dirs: string[] = [];

beforeEach(async () => {
  diffStub.fail = true;
  diffStub.calls = 0;
  root = await mkdtemp(join(tmpdir(), "diff-failure-"));
  dirs.push(root);
  repo = join(root, "repo");
  logPath = join(root, "events.jsonl");
  await mkdir(repo, { recursive: true });
  const g = (args: string[]): void => {
    execFileSync("git", args, { cwd: repo, stdio: "pipe", env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    } });
  };
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  g(["add", "."]);
  g(["commit", "-qm", "init"]);
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true }).catch(() => {});
});

describe("write worker diff 读取失败（fail-visible + 保现场）", () => {
  it("改口 failed、落可见错误、不落 [diff] 收据，worktree/分支/合并塔全部保留", async () => {
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
      modelFor: () => scriptedWorkerModel([
        { type: "tool_call", id: "w1", name: "write_file", args: { path: "a.ts", content: "two\n" } },
        { type: "assistant_message", content: "## 结论\n已写入 a.ts。" },
      ] satisfies ModelOutput[]),
      approvalTimeoutMs: 100,
    });

    const spawned = await orch.spawn({ mode: "write", task: "write a.ts" } as SpawnArgs, { callId: "spawn-1" });
    expect(spawned.ok, spawned.output).toBe(true);
    const id = (JSON.parse(spawned.output) as { agent_id: string }).agent_id;
    await orch.waitAll(20_000);

    expect(diffStub.calls, "没走到 worktreeDiff ⇒ 打桩没量到被测路径").toBeGreaterThan(0);
    const results = events.filter((e): e is Extract<AgentEvent, { type: "agent_result" }> => e.type === "agent_result");
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.reason).toContain("diff_read_failed");
    expect(results[0]!.reason).toMatch(/git index\.lock/);

    const statuses = events.filter((e): e is Extract<AgentEvent, { type: "agent_status" }> => e.type === "agent_status");
    expect(statuses.at(-1)?.status).toBe("failed");
    expect(statuses.some((e) => e.status === "done"), "取证失败不许还报 done").toBe(false);
    expect(events.some((e) => e.type === "agent_message" &&
      String((e as { text?: string }).text ?? "").includes("改动快照读取失败"))).toBe(true);
    expect(events.some((e) => e.type === "tool_result" &&
      String((e as { output?: string }).output ?? "").includes("[diff] v"))).toBe(false);
    expect(events.some((e) => e.type === "tool_result" &&
      String((e as { output?: string }).output ?? "").includes("[worktree] 已清理"))).toBe(false);

    const wtPath = worktreePathFor(repo, id);
    expect(existsSync(wtPath), "worktree 目录必须留在盘上供人工处置").toBe(true);
    expect(existsSync(join(wtPath, "a.ts")), "worker 真写出的文件不许被清理掉").toBe(true);
    expect(orchestratorForMerge(id), "合并控制塔路由仍可到达（mergeWorker 只要求 terminalResolved）").toBe(orch);
  }, 60_000);
});

/* 评审重启与取消树的判卷在 tests/merge-review-restart-cancel.test.ts（同族夹具独立成文件：
   本文件的 execFileSync 形态被安全工具拦新写入，新判卷走 spawnSync 形态）。 */
