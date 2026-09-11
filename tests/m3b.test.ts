// M3b write mode 单测：worktree 生命周期 / 写租约 / git 破坏拦截 / 合并控制塔 / 评审闭环 /
// 安全 gate 流水（绝对行号 + FP 过滤 + LLM 解析）/ 记忆重定向 / 合并塔投影。
// 全部 mock 驱动（scriptedWorkerModel），真实 git 操作在临时仓库（用后即删，仓库主 checkout 零污染）。
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile, lstat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { projectContext } from "../src/agent/context";
import { projectMergeTower, parsePatchLines } from "../src/renderer/projections";
import { remember as rememberTool } from "../src/tools/remember";
import type { ToolContext } from "../src/tools/base";
import {
  Orchestrator,
  WRITE_WORKER_FORBIDDEN_TOOLS,
  WRITE_WORKER_TOOL_TABLE,
  WORKER_TOOL_TABLE,
  buildWorkerToolTable,
  globIntersects,
  interceptDestructiveGit,
  scriptedWorkerModel,
  shell_rw,
  workerToolSpecs,
  type SpawnArgs,
} from "../src/agent/orchestrator";
import {
  branchForAgent,
  cleanOrphanWorktree,
  commitAndMerge,
  createWorktree,
  listWorktreeDirs,
  orphanWorktrees,
  removeWorktree,
  taskSlug,
  worktreeDiff,
  worktreePathFor,
} from "../src/agent/worktree";
import { filterFalsePositives, mapFindingsToAbsolute, scanChangeSet, type ChangeSetEntry } from "../src/agent/security/scan";
import { extractJsonArray, parseLlmFindings } from "../src/agent/security/llm-review";

const exec = promisify(execFile);

let work: string;
let repo: string;
let logPath: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "m3b-test-"));
  repo = join(work, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...args: string[]): Promise<{ stdout: string }> => exec("git", args, { cwd: repo });
  await g("init");
  await g("config", "user.email", "m3b@test.local");
  await g("config", "user.name", "M3b Test");
  await writeFile(join(repo, "README.md"), "line1\nline2\nline3\n", "utf8");
  await g("add", ".");
  await g("commit", "-m", "init");
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

function makeOrch(
  over: {
    events?: AgentEvent[];
    workspace?: string;
    safeMode?: "off" | "report" | "gate";
    model?: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel>;
    approvalTimeoutMs?: number;
  } = {},
): { orch: Orchestrator; events: AgentEvent[] } {
  const events = over.events ?? [];
  const orch = new Orchestrator({
    logPath,
    workspace: over.workspace ?? repo,
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    ...(over.safeMode ? { safeMode: over.safeMode } : {}),
    ...(over.model ? { modelFor: over.model } : {}),
    ...(over.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: over.approvalTimeoutMs } : {}),
  });
  return { orch, events };
}

/** 单发写剧本：一次 write_file → 收束报告。 */
function writeScript(path: string, content: string): Parameters<typeof scriptedWorkerModel>[0] {
  return [
    { type: "tool_call", id: "w-1", name: "write_file", args: { path, content } },
    { type: "assistant_message", content: "改了什么：新增文件。为什么：任务要求。验证方式：无。风险：低。" },
  ] as unknown as Parameters<typeof scriptedWorkerModel>[0];
}

async function waitFor(pred: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

const PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----";

describe("M3b worktree 模块（§4.4.5）", () => {
  it("taskSlug/branchForAgent：安全分支名；createWorktree 记录 base + 建分支 + 目录存在", async () => {
    expect(taskSlug("修复 登录 BUG!!")).toBe("修复-登录-bug");
    expect(branchForAgent("修复 登录 BUG!!", "worker-1")).toBe("agent/修复-登录-bug-worker-1");
    const created = await createWorktree(repo, "worker-1", "修复 登录 BUG");
    expect(created.worktree).toBe(".agents/wt-worker-1");
    expect(created.branch).toBe("agent/修复-登录-bug-worker-1");
    const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    expect(created.baseCommit).toBe(head);
    const st = await lstat(worktreePathFor(repo, "worker-1"));
    expect(st.isDirectory()).toBe(true);
    // 分支存在
    const branches = (await exec("git", ["branch", "--list", created.branch], { cwd: repo })).stdout;
    expect(branches).toContain("agent/修复-登录-bug-worker-1");
    await removeWorktree(repo, "worker-1", { branch: created.branch });
  });

  it("symlink node_modules（fail-visible）：存在则链、失败降级警告不阻断", async () => {
    await mkdir(join(repo, "node_modules"), { recursive: true });
    const created = await createWorktree(repo, "worker-sy", "task");
    const linked = await lstat(join(worktreePathFor(repo, "worker-sy"), "node_modules"));
    expect(linked.isSymbolicLink()).toBe(true);
    await removeWorktree(repo, "worker-sy", { branch: created.branch });
  });

  it("worktreeDiff：vs base_commit 含未提交改动与未跟踪文件（add -N 口径）", async () => {
    const created = await createWorktree(repo, "worker-d", "task");
    const wt = worktreePathFor(repo, "worker-d");
    await writeFile(join(wt, "README.md"), "line1\nchanged\nline3\n", "utf8");
    await writeFile(join(wt, "new.txt"), "untracked\n", "utf8");
    const diff = await worktreeDiff(wt, created.baseCommit);
    expect(diff.patch).toContain("diff --git a/README.md");
    expect(diff.patch).toContain("diff --git a/new.txt");
    expect(diff.patch).toContain("+changed");
    expect(diff.files).toContain("README.md");
    expect(diff.files).toContain("new.txt");
    await removeWorktree(repo, "worker-d", { branch: created.branch });
  });

  it("commitAndMerge：系统代 commit（标注 agent_id）+ merge --no-ff 双亲 + worktree 清理", async () => {
    const created = await createWorktree(repo, "worker-m", "实现功能");
    const wt = worktreePathFor(repo, "worker-m");
    await writeFile(join(wt, "feat.txt"), "feat\n", "utf8");
    const outcome = await commitAndMerge(repo, wt, created.branch, "worker-m", "实现功能");
    expect(outcome.ok).toBe(true);
    // merge --no-ff 双亲
    const parents = (await exec("git", ["rev-list", "--parents", "-n", "1", "HEAD"], { cwd: repo })).stdout.trim().split(" ");
    expect(parents).toHaveLength(3);
    const msg = (await exec("git", ["log", "-1", "--pretty=%B"], { cwd: repo })).stdout;
    expect(msg).toContain("agent worker-m");
    const feat = await readFile(join(repo, "feat.txt"), "utf8");
    expect(feat).toBe("feat\n");
    // worktree 已清（合并路径清理在 orchestrator.cleanupWrite；此处直接验证模块）
    const r = await removeWorktree(repo, "worker-m", { branch: created.branch });
    expect(r.removed).toBe(true);
    expect(r.branchDeleted).toBe(true);
  });

  it("commitAndMerge 冲突：abort 恢复主 checkout 干净态 + 冲突清单（不自动解）", async () => {
    const created = await createWorktree(repo, "worker-c", "task");
    const wt = worktreePathFor(repo, "worker-c");
    await writeFile(join(wt, "README.md"), "line1\nworker 改\nline3\n", "utf8");
    // 主 checkout 同区提交（合并必冲突）
    await writeFile(join(repo, "README.md"), "line1\n主 checkout 改\nline3\n", "utf8");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "main advance"], { cwd: repo });
    const outcome = await commitAndMerge(repo, wt, created.branch, "worker-c", "task");
    expect(outcome.ok).toBe(false);
    expect(outcome.conflict).toBe(true);
    expect(outcome.conflictedFiles?.length).toBeGreaterThan(0);
    // 主 checkout 干净态（merge 已 abort，无未合并路径）
    const status = (await exec("git", ["status", "--porcelain"], { cwd: repo })).stdout;
    expect(status).not.toMatch(/^UU/m);
    const readme = await readFile(join(repo, "README.md"), "utf8");
    expect(readme).toContain("主 checkout 改"); // 主侧内容未被动
    await removeWorktree(repo, "worker-c", { branch: created.branch });
  });

  it("removeWorktree：git 认与不认（残留目录）两路都清干净", async () => {
    const c1 = await createWorktree(repo, "worker-r1", "task");
    const r1 = await removeWorktree(repo, "worker-r1", { branch: c1.branch });
    expect(r1.removed).toBe(true);
    await expect(lstat(worktreePathFor(repo, "worker-r1"))).rejects.toThrow();
    // 残留目录但 git 元数据已丢 → 物理删除兜底
    const c2 = await createWorktree(repo, "worker-r2", "task");
    await rm(join(repo, ".git", "worktrees", "wt-worker-r2"), { recursive: true, force: true });
    const r2 = await removeWorktree(repo, "worker-r2", { branch: c2.branch });
    expect(r2.removed).toBe(true);
  });

  it("orphanWorktrees：无终态且无收尾记录 → 孤儿；终态/收尾 → 非孤儿；cleanOrphanWorktree 真清", async () => {
    await createWorktree(repo, "worker-o1", "task");
    await createWorktree(repo, "worker-o2", "task");
    const dirs = await listWorktreeDirs(repo);
    expect(dirs).toEqual(["wt-worker-o1", "wt-worker-o2"]);
    const events = [
      { type: "agent_status", agent_id: "worker-o1", status: "done" },
    ];
    expect(orphanWorktrees(dirs, events)).toEqual(["worker-o2"]);
    // merge-/wt-cleanup- 收尾记录同样算非孤儿
    expect(orphanWorktrees(dirs, [{ type: "tool_result", callId: "merge-worker-o2" }])).toEqual(["worker-o1"]);
    const r = await cleanOrphanWorktree(repo, "worker-o2");
    expect(r.removed).toBe(true);
    await expect(lstat(worktreePathFor(repo, "worker-o2"))).rejects.toThrow();
    // 分支按后缀删除（agent/*-worker-o2）
    const branches = (await exec("git", ["branch", "--list", "agent/*-worker-o2"], { cwd: repo })).stdout.trim();
    expect(branches).toBe("");
    await cleanOrphanWorktree(repo, "worker-o1");
  });
});

describe("M3b 写租约（§4.4.5 预测器）+ git 破坏拦截", () => {
  it("globIntersects：** / 精确 / 目录前缀双向相交", () => {
    expect(globIntersects("src/**", "src/todo.ts")).toBe(true);
    expect(globIntersects("src/todo.ts", "src/**")).toBe(true);
    expect(globIntersects("src", "src/todo.ts")).toBe(true); // 目录前缀语义
    expect(globIntersects("src/todo.ts", "src/todo.ts")).toBe(true);
    expect(globIntersects("src/**", "tests/x.ts")).toBe(false);
    expect(globIntersects("docs/*.md", "src/todo.ts")).toBe(false);
  });

  it("leaseConflicts：活跃 write worker 的 resources 相交才报", async () => {
    const hang = new Map<string, () => void>();
    const { orch } = makeOrch({
      model: (args) => {
        const task = String(args.task);
        return (async function* () {
          yield { type: "tool_call", id: "t-" + task, name: "write_file", args: { path: "f-" + task + ".txt", content: "x" } } as AgentEvent;
          await new Promise<void>((r) => hang.set(task, r));
        }) as unknown as ReturnType<typeof scriptedWorkerModel>;
      },
    });
    const r1 = await orch.spawn({ mode: "write", task: "a", resources: ["src/**"] }, { callId: "l1" });
    expect(r1.ok).toBe(true);
    for (let i = 0; i < 40 && hang.size < 1; i++) await new Promise((r) => setTimeout(r, 25));
    expect(orch.leaseConflicts(["src/todo.ts"])).toHaveLength(1);
    expect(orch.leaseConflicts(["tests/x.ts"])).toHaveLength(0);
    orch.cancelAll();
    for (const fn of [...hang.values()]) fn();
    await orch.waitAll(5_000);
    // 终态后租约释放
    expect(orch.leaseConflicts(["src/todo.ts"])).toHaveLength(0);
  });

  it("租约相交 → approval_requested（警告落流）→ 拒绝则 spawn 失败；强行批准则继续", async () => {
    const hang = new Map<string, () => void>();
    const { orch, events } = makeOrch({
      approvalTimeoutMs: 5_000,
      model: (args) => {
        const task = String(args.task);
        return (async function* () {
          yield { type: "tool_call", id: "t-" + task, name: "write_file", args: { path: "f-" + task + ".txt", content: "x" } } as AgentEvent;
          if (task === "lease-a") await new Promise<void>((r) => hang.set(task, r));
        }) as unknown as ReturnType<typeof scriptedWorkerModel>;
      },
    });
    const r1 = await orch.spawn({ mode: "write", task: "lease-a", resources: ["src/**"] }, { callId: "la" });
    expect(r1.ok).toBe(true);
    for (let i = 0; i < 40 && hang.size < 1; i++) await new Promise((r) => setTimeout(r, 25));
    // 第二个相交 spawn： approval_requested 落流 → 拒绝 → spawn 失败
    const p1 = orch.spawn({ mode: "write", task: "lease-b", resources: ["src/todo.ts"] }, { callId: "lb" });
    await waitFor(() => events.some((e) => e.type === "approval_requested" && (e as { tool?: string }).tool === "spawn_agent"));
    const apr = events.find((e) => e.type === "approval_requested" && (e as { tool?: string }).tool === "spawn_agent") as
      | Extract<AgentEvent, { type: "approval_requested" }>
      | undefined;
    expect(apr?.agent_id).toBeDefined();
    expect((apr?.risk_reasons ?? []).join(" ")).toContain("写租约相交");
    expect(orch.decideWorkerApproval(apr!.id, false, "once").ok).toBe(true);
    const rejected = await p1;
    expect(rejected.ok).toBe(false);
    expect(rejected.output).toContain("未获批准");
    // 第三个相交 spawn：强行批准 → 继续（租约是预测器不是硬闸）
    const p2 = orch.spawn({ mode: "write", task: "lease-c", resources: ["src/todo.ts"] }, { callId: "lc" });
    await waitFor(() => (events.filter((e) => e.type === "approval_requested" && (e as { tool?: string }).tool === "spawn_agent")).length >= 2);
    const apr2 = events.filter((e) => e.type === "approval_requested" && (e as { tool?: string }).tool === "spawn_agent").pop() as
      | Extract<AgentEvent, { type: "approval_requested" }>
      | undefined;
    expect(orch.decideWorkerApproval(apr2!.id, true, "once").ok).toBe(true);
    const forced = await p2;
    expect(forced.ok).toBe(true);
    orch.cancelAll();
    for (const fn of [...hang.values()]) fn();
    await orch.waitAll(5_000);
  }, 20_000);

  it("interceptDestructiveGit：写向 git 子命令全拦 + reason 落流；只读 git 放行", async () => {
    expect(interceptDestructiveGit("git push").ok).toBe(false);
    expect(interceptDestructiveGit("git commit -m x").ok).toBe(false);
    expect(interceptDestructiveGit("git merge main").ok).toBe(false);
    expect(interceptDestructiveGit("git worktree remove .agents/wt-1").ok).toBe(false);
    expect(interceptDestructiveGit("git checkout main").ok).toBe(false);
    expect(interceptDestructiveGit("git reset --hard").ok).toBe(false);
    expect(interceptDestructiveGit("git clean -fd").ok).toBe(false);
    expect(interceptDestructiveGit("cat a && git rebase main").ok).toBe(false); // 链段全查
    expect(interceptDestructiveGit("git status").ok).toBe(true);
    expect(interceptDestructiveGit("git diff HEAD~1").ok).toBe(true);
    expect(interceptDestructiveGit("node build.js").ok).toBe(true);
    expect(interceptDestructiveGit("npm test").ok).toBe(true);
    // shell_rw 工具本体：拒绝 reason 在 output（落流可审计）
    const ctx = { workspace: repo } as unknown as ToolContext;
    const denied = await shell_rw.run({ command: "git push origin main" }, ctx);
    expect(denied.ok).toBe(false);
    expect(denied.output).toContain("[git-guard]");
    expect(denied.output).toContain("合并唯一出口");
  });
});

describe("M3b write worker 闭环（临时 git 仓库端到端）", () => {
  it("spawn(write) → worktree 内写文件 → done 出 diff/stat/agent_result（主上下文只有 stat 摘要，无 patch 本体）", async () => {
    const { orch, events } = makeOrch({ model: () => scriptedWorkerModel(writeScript("feat.txt", "feat-1\nfeat-2\n")) });
    const r = await orch.spawn({ mode: "write", task: "新增 feat 文件" }, { callId: "s1" });
    expect(r.ok).toBe(true);
    const agentId = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    expect(await waitFor(() => events.some((e) => e.type === "agent_result"))).toBe(true);
    const spawned = events.find((e) => e.type === "agent_spawned") as Extract<AgentEvent, { type: "agent_spawned" }>;
    expect(spawned.mode).toBe("write");
    expect(spawned.worktree).toBe(".agents/wt-" + agentId);
    expect(spawned.base_commit).toMatch(/^[0-9a-f]{40}$/);
    // 文件真实落在 worktree（主 checkout 不动）
    expect(await readFile(join(worktreePathFor(repo, agentId), "feat.txt"), "utf8")).toBe("feat-1\nfeat-2\n");
    await expect(readFile(join(repo, "feat.txt"), "utf8")).rejects.toThrow();
    // diff 快照事件（子流，callId=diff-<id>）
    const diffEvent = events.find((e) => e.type === "tool_result" && e.callId === "diff-" + agentId) as Extract<AgentEvent, { type: "tool_result" }>;
    expect(diffEvent.agent_id).toBe(agentId);
    expect(diffEvent.output).toContain("## stat");
    expect(diffEvent.output).toContain("+feat-1");
    // agent_result.artifacts：files_changed + diff_ref（stat 摘要口径）
    const result = events.find((e) => e.type === "agent_result") as Extract<AgentEvent, { type: "agent_result" }>;
    expect(result.artifacts.files_changed).toContain("feat.txt");
    expect(result.artifacts.diff_ref).toContain(".agents/wt-" + agentId);
    // 合成 tool_result（父上下文唯一接收物）：无 patch 本体
    const synthetic = events.filter((e) => e.type === "tool_result" && e.callId === "s1").pop() as Extract<AgentEvent, { type: "tool_result" }>;
    expect(synthetic.output).toContain("[harness]");
    expect(synthetic.output).not.toContain("+feat-1");
    // 主上下文投影：patch 本体不进父上下文
    const all = await replay(logPath);
    const ctx = JSON.stringify(projectContext(all));
    expect(ctx).not.toContain("+feat-1");
    expect(ctx).toContain("diff_ref");
    // done 不清 worktree（等合并决策）
    expect(await lstat(worktreePathFor(repo, agentId))).toBeTruthy();
  }, 20_000);

  it("合并控制塔：mergeWorker → 主分支前进 + worktree/分支清理；拒绝 → 清理（可留分支）", async () => {
    const { orch, events } = makeOrch({ model: () => scriptedWorkerModel(writeScript("m.txt", "m-1\n")) });
    const r = await orch.spawn({ mode: "write", task: "写 m 文件" }, { callId: "s1" });
    const agentId = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    await waitFor(() => events.some((e) => e.type === "agent_result"));
    const base = (await exec("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const merged = await orch.mergeWorker(agentId);
    expect(merged.ok).toBe(true);
    const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    expect(head).not.toBe(base); // 主分支前进
    const parents = (await exec("git", ["rev-list", "--parents", "-n", "1", "HEAD"], { cwd: repo })).stdout.trim().split(" ");
    expect(parents).toHaveLength(3); // --no-ff 双亲
    expect(await readFile(join(repo, "m.txt"), "utf8")).toBe("m-1\n");
    // worktree + 分支清理 + 控制塔路由注销
    await expect(lstat(worktreePathFor(repo, agentId))).rejects.toThrow();
    const branches = (await exec("git", ["branch", "--list", "agent/*-" + agentId], { cwd: repo })).stdout.trim();
    expect(branches).toBe("");
    expect(events.some((e) => e.type === "tool_result" && e.callId === "merge-" + agentId && (e as { output: string }).output.startsWith("[merged]"))).toBe(true);
  }, 20_000);

  it("拒绝路径：rejectWorker 清理 worktree + 分支；keep_branch 保留", async () => {
    const { orch, events } = makeOrch({ model: () => scriptedWorkerModel(writeScript("rj.txt", "rj\n")) });
    const r1 = await orch.spawn({ mode: "write", task: "写 rj", max_turns: 2 }, { callId: "s1" });
    const id1 = (JSON.parse(r1.output) as { agent_id: string }).agent_id;
    await waitFor(() => events.filter((e) => e.type === "agent_result").length >= 1);
    const rej = await orch.rejectWorker(id1);
    expect(rej.ok).toBe(true);
    await expect(lstat(worktreePathFor(repo, id1))).rejects.toThrow();
    expect((await exec("git", ["branch", "--list", "agent/*-" + id1], { cwd: repo })).stdout.trim()).toBe("");
    expect(events.some((e) => e.type === "tool_result" && e.callId === "merge-" + id1 && (e as { output: string }).output.startsWith("[rejected]"))).toBe(true);
  }, 20_000);

  it("失败/取消自动清理（四路清理之三/四）：failed 与 cancelled 后 worktree 零残留", async () => {
    // failed：剧本抛错（tool_call 后停止产出 + max_turns=1 → maxSteps 炸）
    let i = 0;
    const failing = (async function* () {
      yield { type: "tool_call", id: "e" + String(i++), name: "write_file", args: { path: "x.txt", content: "y" } } as AgentEvent;
    }) as unknown as ReturnType<typeof scriptedWorkerModel>;
    const { orch: orchF, events: evF } = makeOrch({ model: () => failing });
    const rf = await orchF.spawn({ mode: "write", task: "失败演练", max_turns: 1 }, { callId: "f1" });
    const idf = (JSON.parse(rf.output) as { agent_id: string }).agent_id;
    expect(await waitFor(() => evF.some((e) => e.type === "agent_status" && e.agent_id === idf && e.status === "failed"))).toBe(true);
    await expect(lstat(worktreePathFor(repo, idf))).rejects.toThrow(); // 自动清理
    // cancelled：挂起后取消
    const hang = new Map<string, () => void>();
    const { orch: orchC, events: evC } = makeOrch({
      model: (args) => {
        const task = String(args.task);
        return (async function* () {
          yield { type: "tool_call", id: "c-" + task, name: "write_file", args: { path: "c.txt", content: "x" } } as AgentEvent;
          await new Promise<void>((r) => hang.set(task, r));
        }) as unknown as ReturnType<typeof scriptedWorkerModel>;
      },
    });
    const rc = await orchC.spawn({ mode: "write", task: "取消演练" }, { callId: "c1" });
    const idc = (JSON.parse(rc.output) as { agent_id: string }).agent_id;
    for (let k = 0; k < 40 && hang.size < 1; k++) await new Promise((r) => setTimeout(r, 25));
    expect(orchC.cancelAgent(idc)).toBe(true);
    hang.get("取消演练")?.();
    await orchC.waitAll(5_000);
    expect(evC.some((e) => e.type === "tool_result" && e.callId === "wt-cleanup-" + idc)).toBe(true);
    await expect(lstat(worktreePathFor(repo, idc))).rejects.toThrow();
  }, 20_000);

  it("记忆重定向（裁决 2）：write worker 跑完后 worktree 内零 .agent/memory，主 checkout 记忆可见", async () => {
    process.env.M2D_MEMORY_HOME = join(work, "global-mem");
    const script = [
      { type: "tool_call", id: "m-1", name: "remember", args: { scope: "project", kind: "memory", type: "project", topic: "m3b-redirect", content: "M3B-MEMORY-REDIRECT-CANARY" } },
      { type: "assistant_message", content: "写完并沉淀记忆。" },
    ] as unknown as Parameters<typeof scriptedWorkerModel>[0];
    const { orch, events } = makeOrch({ model: () => scriptedWorkerModel(script) });
    const r = await orch.spawn({ mode: "write", task: "写并记忆" }, { callId: "s1" });
    const agentId = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    // remember 非副作用工具（L4 风险通道无命中）→ 自动放行直接执行，无需审批
    expect(await waitFor(() => events.some((e) => e.type === "agent_result"))).toBe(true);
    // 主 checkout 记忆可见（remember 走 ctx.workspace=主根）
    const memBody = await readFile(join(repo, ".agent", "memory", "m3b-redirect.md"), "utf8");
    expect(memBody).toContain("M3B-MEMORY-REDIRECT-CANARY");
    // worktree 内零 .agent/memory（done 未清理，可直接断言 worktree 内部）
    const wtMem = await readFile(join(worktreePathFor(repo, agentId), ".agent", "memory", "m3b-redirect.md"), "utf8").catch(() => null);
    expect(wtMem).toBeNull();
    delete process.env.M2D_MEMORY_HOME;
  }, 20_000);

  it("无合并权断言：worker 工具表与主 loop TOOLS 都无 merge/commit 能力；write 深度闸保持", async () => {
    const w: Parameters<typeof buildWorkerToolTable>[0] = {
      agentId: "x", spawnCallId: "", mode: "write", task: "t", context: {}, maxTurns: 5, tier: "default",
      controller: new AbortController(), autonomy: {} as never, toolAutonomy: {} as never, resources: [],
      snapshots: new Map(), editAnchors: new Map(), lastFindings: [], events: [],
      usage: { inputTokens: 0, outputTokens: 0 }, toolStats: {}, finished: false,
    };
    const { orch } = makeOrch({ model: () => scriptedWorkerModel([]) });
    const table = buildWorkerToolTable(w, orch);
    const names = Object.keys(table);
    for (const banned of [...WRITE_WORKER_FORBIDDEN_TOOLS, "shell_ro"]) {
      expect(names).not.toContain(banned);
    }
    expect(names).toEqual(expect.arrayContaining(["write_file", "edit_file", "shell_rw", "remember", "read_file"]));
    const specNames = workerToolSpecs("write").map((s) => s.function.name);
    for (const banned of WRITE_WORKER_FORBIDDEN_TOOLS) expect(specNames).not.toContain(banned);
    // read worker 工具表不变
    expect(WORKER_TOOL_TABLE).not.toContain("shell_rw");
    expect(WRITE_WORKER_TOOL_TABLE).toContain("shell_rw");
    // 主 loop TOOLS（注入 spawn_agent/remember 后）无 merge/commit 工具
    const { TOOLS } = await import("../src/tools");
    expect(Object.keys(TOOLS)).not.toContain("merge");
    expect(Object.keys(TOOLS)).not.toContain("commit");
    expect(Object.keys(TOOLS)).not.toContain("spawn_agent_merge");
  });

  it("评审闭环（§4.5）：done → diff v1 → diff_comment 注入 → 评审重启 → diff v2（同 agent 同 base）", async () => {
    const script = [
      { type: "tool_call", id: "rv-1", name: "write_file", args: { path: "rv.txt", content: "v1\n" } },
      { type: "assistant_message", content: "v1 完成。" },
      { type: "tool_call", id: "rv-2", name: "write_file", args: { path: "rv.txt", content: "v1\nv2-修正\n" } },
      { type: "assistant_message", content: "按评审意见补了 v2。" },
    ] as unknown as Parameters<typeof scriptedWorkerModel>[0];
    const { orch, events } = makeOrch({ model: () => scriptedWorkerModel(script) });
    const r = await orch.spawn({ mode: "write", task: "评审演练" }, { callId: "s1" });
    const agentId = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    expect(await waitFor(() => events.some((e) => e.type === "agent_result"))).toBe(true);
    const diffs1 = events.filter((e) => e.type === "tool_result" && e.callId === "diff-" + agentId) as Extract<AgentEvent, { type: "tool_result" }>[];
    expect(diffs1).toHaveLength(1);
    expect(diffs1[0]!.output).toContain("+v1");
    // 评论注入（done 但 worktree 未收尾 → 评审重启）：agent_status 回 running，第二轮 done 出 v2
    const injected = await orch.injectComment(agentId, "rv.txt", 1, "请补第二行");
    expect(injected.injected).toBe(true);
    expect(await waitFor(() => (events.filter((e) => e.type === "tool_result" && e.callId === "diff-" + agentId).length >= 2))).toBe(true);
    const diffs = events.filter((e) => e.type === "tool_result" && e.callId === "diff-" + agentId) as Extract<AgentEvent, { type: "tool_result" }>[];
    expect(diffs[1]!.output).toContain("+v2-修正"); // v2 diff（同 agent 同 base）
    expect(diffs[1]!.output).toContain("v2 vs"); // 版本号递增
    expect(events.some((e) => e.type === "agent_message" && (e as { text: string }).text.includes("[review]"))).toBe(true);
    // 重启后再次终态：agent_result 两拍（v1 与 v2）
    expect(events.filter((e) => e.type === "agent_result" && e.agent_id === agentId)).toHaveLength(2);
    // worktree 已收尾（merged/rejected/cleaned）后注入 → 只落流
    const rej = await orch.rejectWorker(agentId);
    expect(rej.ok).toBe(true);
    const after = await orch.injectComment(agentId, "rv.txt", 2, "晚了");
    expect(after.ok).toBe(true);
    expect(after.injected).toBe(false);
  }, 20_000);

  it("冲突卡：主分支前进后合并 → conflict 收尾态 + 主 checkout 干净（不自动解）", async () => {
    const { orch, events } = makeOrch({ model: () => scriptedWorkerModel(writeScript("README.md", "line1\nworker 改\nline3\n")) });
    const r = await orch.spawn({ mode: "write", task: "改 README" }, { callId: "s1" });
    const agentId = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    await waitFor(() => events.some((e) => e.type === "agent_result"));
    await writeFile(join(repo, "README.md"), "line1\n主改\nline3\n", "utf8");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "main advance"], { cwd: repo });
    const merged = await orch.mergeWorker(agentId);
    expect(merged.ok).toBe(false);
    expect(merged.error).toContain("冲突");
    const conflictEvent = events.find((e) => e.type === "tool_result" && e.callId === "merge-" + agentId) as Extract<AgentEvent, { type: "tool_result" }>;
    expect(conflictEvent.output).toContain("[conflict]");
    const status = (await exec("git", ["status", "--porcelain"], { cwd: repo })).stdout;
    expect(status).not.toMatch(/^UU/m);
  }, 20_000);
});

describe("M3b 安全 gate 流水（§11.6 三档）", () => {
  it("off 零行为：不产 security_report；report 只标：报告在场、合并不拦", async () => {
    const script = writeScript("sec.txt", "safe content\n");
    const off = makeOrch({ safeMode: "off", model: () => scriptedWorkerModel(script) });
    const rOff = await off.orch.spawn({ mode: "write", task: "off 演练" }, { callId: "o1" });
    const idOff = (JSON.parse(rOff.output) as { agent_id: string }).agent_id;
    await waitFor(() => off.events.some((e) => e.type === "agent_result"));
    expect(off.events.some((e) => e.type === "security_report")).toBe(false);
    const mergedOff = await off.orch.mergeWorker(idOff);
    expect(mergedOff.ok).toBe(true);

    const rep = makeOrch({ safeMode: "report", model: () => scriptedWorkerModel(writeScript("sec2.txt", "also safe\n")) });
    const rRep = await rep.orch.spawn({ mode: "write", task: "report 演练" }, { callId: "o2" });
    const idRep = (JSON.parse(rRep.output) as { agent_id: string }).agent_id;
    await waitFor(() => rep.events.some((e) => e.type === "agent_result"));
    const report = rep.events.find((e) => e.type === "security_report") as Extract<AgentEvent, { type: "security_report" }>;
    expect(report.agent_id).toBe(idRep);
    expect(report.mode).toBe("report");
    const mergedRep = await rep.orch.mergeWorker(idRep);
    expect(mergedRep.ok).toBe(true); // report 只标不拦
  });

  it("gate 红标 + 二次确认：critical finding → 第一次合并拒绝；force=true 仍要合并成功", async () => {
    const script = writeScript("leak.txt", PRIVATE_KEY + "\n");
    const { orch, events } = makeOrch({ safeMode: "gate", model: () => scriptedWorkerModel(script) });
    const r = await orch.spawn({ mode: "write", task: "密钥演练" }, { callId: "g1" });
    const agentId = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    await waitFor(() => events.some((e) => e.type === "agent_result"));
    const report = events.find((e) => e.type === "security_report") as Extract<AgentEvent, { type: "security_report" }>;
    expect(report.mode).toBe("gate");
    expect(report.summary.bySeverity.critical).toBeGreaterThanOrEqual(1);
    const finding = report.findings.find((f) => f.severity === "critical");
    expect(finding?.line).toBe(1); // write op 绝对行号 = 文件行号
    // 第一次合并：gate 拒绝 + 红标注记落流
    const first = await orch.mergeWorker(agentId);
    expect(first.ok).toBe(false);
    expect(first.error).toContain("二次确认");
    const gateEvent = events.find((e) => e.type === "tool_result" && e.callId === "merge-" + agentId) as Extract<AgentEvent, { type: "tool_result" }>;
    expect(gateEvent.output).toContain("[gate]");
    // force 仍要合并（合并权永远在人）
    const forced = await orch.mergeWorker(agentId, { force: true });
    expect(forced.ok).toBe(true);
    expect(await readFile(join(repo, "leak.txt"), "utf8")).toContain("PRIVATE KEY");
  }, 20_000);

  it("edit_file findings 绝对行号（M2f 裁决 6）：写前快照锚点换算", async () => {
    const target = join(repo, "code.ts");
    await writeFile(target, "a\nb\nc\nd\ne\nf\ng\nh\ni\nconst x = 1;\n", "utf8"); // 第 10 行
    // worktree 从 HEAD 建：code.ts 必须先入库（untracked 不进 worktree）
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "code"], { cwd: repo });
    const script = [
      { type: "tool_call", id: "ed-1", name: "edit_file", args: { path: "code.ts", old_string: "const x = 1;", new_string: "const x = eval(input);" } },
      { type: "assistant_message", content: "改完了。" },
    ] as unknown as Parameters<typeof scriptedWorkerModel>[0];
    const { orch, events } = makeOrch({ safeMode: "report", model: () => scriptedWorkerModel(script) });
    const r = await orch.spawn({ mode: "write", task: "改 code" }, { callId: "s1" });
    const agentId = (JSON.parse(r.output) as { agent_id: string }).agent_id;
    await waitFor(() => events.some((e) => e.type === "agent_result"));
    const report = events.find((e) => e.type === "security_report") as Extract<AgentEvent, { type: "security_report" }>;
    const finding = report.findings.find((f) => f.ruleId === "danger.eval");
    expect(finding).toBeDefined();
    expect(finding?.path).toBe("code.ts");
    expect(finding?.line).toBe(10); // 绝对行号（文件第 10 行），不是变更集内相对行号 1
    // worktree 内文件真实状态一致
    const wt = await readFile(join(worktreePathFor(repo, agentId), "code.ts"), "utf8");
    expect(wt.split("\n")[9]).toBe("const x = eval(input);");
  });

  it("FP 过滤 pass：DoS/输入校验类降级 low + note；有影响面证据不降", () => {
    const fp = filterFalsePositives([
      { ruleId: "llm.1", category: "llm_review", severity: "high", path: "a.ts", line: 1, title: "缺少输入校验可能导致 DoS", description: "输入未校验，攻击者可发送大量请求", confidence: "medium" },
      { ruleId: "llm.2", category: "llm_review", severity: "high", path: "b.ts", line: 2, title: "缺少输入校验", description: "但该输入拼接进 SQL，可注入凭据窃取", confidence: "high" },
      { ruleId: "llm.3", category: "llm_review", severity: "low", path: "c.ts", line: 3, title: "风格", description: "低危", confidence: "low" },
    ]);
    expect(fp[0]!.severity).toBe("low");
    expect(fp[0]!.description).toContain("FP 过滤 pass");
    expect(fp[1]!.severity).toBe("high"); // 有影响面证据（注入）
    expect(fp[2]!.severity).toBe("low");
  });

  it("LLM findings 解析：严格 schema（非法丢弃）+ 输出扫描 + JSON 提取", () => {
    const raw = [
      "审查中……一些闲话",
      "```json",
      JSON.stringify([
        { severity: "high", path: "x.ts", line: 3, title: "命令注入", description: "拼接", suggestion: "用 execFile", confidence: "high" },
        { severity: "ohno", path: "y.ts", line: 1, title: "非法 severity", description: "", confidence: "high" },
        { severity: "medium", path: "z.ts", line: 0, title: "非法行号", description: "", confidence: "low" },
        { severity: "high", path: "k.ts", line: 2, title: "泄露 sk-abcdefghijklmnopqrstuvwxyz012345", description: "密钥", confidence: "high" },
      ]),
      "```",
    ].join("\n");
    const findings = parseLlmFindings(raw);
    expect(findings).toHaveLength(2); // 非法 severity / line=0 被严格 schema 丢弃
    expect(findings[0]!.ruleId).toMatch(/^llm\./);
    expect(findings[0]!.category).toBe("llm_review");
    expect(findings[0]!.suggestion).toBe("用 execFile");
    expect(findings[1]!.title).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345"); // 输出扫描脱敏
    expect(findings[1]!.title).toContain("sk-a****");
    expect(extractJsonArray("no json here")).toEqual([]);
  });
});

describe("M3b 合并控制塔投影（纯函数）", () => {
  it("projectMergeTower：write 列 / diff 快照累积 / findings / 评论 / 收尾态", () => {
    const base = "a".repeat(40);
    const events: AgentEvent[] = [
      { type: "agent_spawned", agent_id: "w1", parent_event_id: 1, mode: "write", task: "写 x", max_turns: 5, permission_mode: "default", worktree: ".agents/wt-w1", base_commit: base },
      { type: "agent_status", agent_id: "w1", status: "done" },
      { type: "tool_result", callId: "diff-w1", agent_id: "w1", ok: true, output: "[diff] v1 vs aaaaaaaaaaa（worktree .agents/wt-w1，含未提交改动）\n## stat\n x.ts | 1 +\n## patch\ndiff --git a/x.ts b/x.ts\n+++ b/x.ts\n@@ -0,0 +1 @@\n+v1" },
      { type: "security_report", mode: "gate", agent_id: "w1", findings: [{ ruleId: "secret.private_key", category: "secret", severity: "critical", path: "k.ts", line: 1, title: "私钥块", description: "d", confidence: "high" }], changeSet: [], summary: { total: 1, bySeverity: { low: 0, medium: 0, high: 0, critical: 1 }, byCategory: { secret: 1 } } },
      { type: "diff_comment", agent_id: "w1", path: "x.ts", line: 1, body: "补注释" },
      { type: "tool_result", callId: "merge-w1", agent_id: "w1", ok: false, output: "[gate] 需二次确认" },
    ];
    const cols = projectMergeTower(events);
    expect(cols).toHaveLength(1);
    const col = cols[0]!;
    expect(col.branch).toContain("w1");
    expect(col.status).toBe("done");
    expect(col.diffs).toHaveLength(1);
    expect(col.diffs[0]!.patch).toContain("+v1");
    expect(col.report?.mode).toBe("gate");
    expect(col.report?.summary.critical).toBe(1);
    expect(col.comments).toEqual([{ path: "x.ts", line: 1, body: "补注释" }]);
    expect(col.outcome).toBe("gate-confirm");
    // v2：第二份 diff 追加
    events.push({ type: "tool_result", callId: "diff-w1", agent_id: "w1", ok: true, output: "[diff] v2 vs aaaaaaaaaaa\n## stat\n x.ts | 2 +\n## patch\ndiff --git a/x.ts b/x.ts\n+++ b/x.ts\n@@ -0,0 +1,2 @@\n+v1\n+v2" });
    const cols2 = projectMergeTower(events);
    expect(cols2[0]!.diffs).toHaveLength(2);
    expect(cols2[0]!.diffs[1]!.patch).toContain("+v2");
    // merged 收尾态
    events.push({ type: "tool_result", callId: "merge-w1", agent_id: "w1", ok: true, output: "[merged] 已合并" });
    expect(projectMergeTower(events)[0]!.outcome).toBe("merged");
  });

  it("parsePatchLines：hunk 行号推导（新增/上下文行有新行号，删除行 null）", () => {
    const patch = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,3 +1,4 @@",
      " ctx",
      "-old",
      "+new1",
      "+new2",
      " ctx2",
    ].join("\n");
    const lines = parsePatchLines(patch);
    expect(lines.map((l) => l.newLine)).toEqual([null, null, null, null, 1, null, 2, 3, 4]);
    expect(lines[6]!.text).toBe("+new1");
  });

  it("diff_comment / scanChangeSet 绝对行号映射：mapFindingsToAbsolute 纯函数", () => {
    const entries: ChangeSetEntry[] = [
      { path: "a.ts", op: "write", lines: ["safe", "eval(x)", "safe"] },
      { path: "b.ts", op: "edit", lines: ["eval(y)"] },
    ];
    const findings = scanChangeSet(entries).filter((f) => f.ruleId === "danger.eval");
    expect(findings).toHaveLength(2);
    const anchors = new Map([["b.ts", [42]]]);
    const mapped = mapFindingsToAbsolute(entries, findings, anchors);
    expect(mapped.find((f) => f.path === "a.ts")!.line).toBe(2); // write op：文件行号
    expect(mapped.find((f) => f.path === "b.ts")!.line).toBe(42); // edit op：写前快照锚点 + 偏移
  });
});
