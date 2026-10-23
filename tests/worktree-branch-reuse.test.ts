// worker worktree 的分支撞名判卷（真跑 git，不 mock）。
//
// 立项动因（2026-10-23 实测）：`pnpm supervisor-check` 的 E3 稳定三红，报
// `spawn_agent: worktree 创建失败 … git worktree add .agents/wt-worker-12
//  agent/修复-todo-的-completedcount-worker-12 失败：fatal: unable to read tree`。
// 根因不在 git：worker 的 agentId 是**进程内**序列（orchestrator.ts#nextAgentId 从 1 重来），
// 而分支是跨进程留在仓库里的；同名分支被 `createWorktree` 当成“同 agent 重启”挂载，
// 于是新 worker 会站在**旧提交**上干活（baseCommit 却是当前 HEAD），或者旧分支本身坏了就整次 spawn 失败。
// 这条判卷钉的是：撞名 ⇒ 换名新建，恒从当前 HEAD 起；旧分支原样不动。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { branchForAgent, cleanOrphanWorktree, createWorktree, removeWorktree, worktreePathFor } from "../src/agent/worktree";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const roots: string[] = [];
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-wt-reuse-"));
  roots.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "judge@example.com");
  git(dir, "config", "user.name", "judge");
  writeFileSync(join(dir, "a.txt"), "base\n", "utf8");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}
const head = (root: string): string => git(root, "rev-parse", "HEAD").trim();
const tip = (root: string, branch: string): string => git(root, "rev-parse", branch).trim();

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("createWorktree：worker 的 agentId 跨进程重号，不许挂载旧同名分支", () => {
  it("未撞名：分支名仍逐字等于 branchForAgent（正常路径不搬家）", async () => {
    const root = repo();
    const created = await createWorktree(root, "worker-1", "修一下 todo");
    expect(created.branch).toBe(branchForAgent("修一下 todo", "worker-1"));
    expect(created.baseCommit).toBe(head(root));
    await removeWorktree(root, "worker-1", { branch: created.branch });
  });

  it("撞名：换名新建，新树从当前 HEAD 起，旧分支原样不动", async () => {
    const root = repo();
    const first = await createWorktree(root, "worker-1", "同一任务");
    const firstTip = tip(root, first.branch);

    // 主分支前进：新树必须看得见这个提交（挂旧分支就看不见）
    writeFileSync(join(root, "b.txt"), "after\n", "utf8");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "move on");
    const now = head(root);
    expect(now).not.toBe(firstTip);

    const second = await createWorktree(root, "worker-1", "同一任务");
    expect(second.branch).not.toBe(first.branch);
    expect(second.branch).toBe(first.branch.replace("-worker-1", "-2-worker-1"));
    expect(second.baseCommit).toBe(now);
    expect(tip(root, second.branch)).toBe(now);
    // 关键行为：新树里真的有主分支那个提交的文件
    expect(readFileSync(join(worktreePathFor(root, "worker-1"), "b.txt"), "utf8")).toBe("after\n");
    // 旧分支一个字节没动
    expect(tip(root, first.branch)).toBe(firstTip);

    await removeWorktree(root, "worker-1", { branch: second.branch });
    git(root, "branch", "-D", first.branch);
  });

  it("撞名时后缀继续避让（-2 已被占 ⇒ 用 -3）", async () => {
    const root = repo();
    const first = await createWorktree(root, "worker-2", "同一任务");
    // 再手动占掉 -2
    const secondName = first.branch.replace("-worker-2", "-2-worker-2");
    git(root, "branch", secondName, head(root));

    const second = await createWorktree(root, "worker-2", "同一任务");
    expect(second.branch).toBe(first.branch.replace("-worker-2", "-3-worker-2"));
    await removeWorktree(root, "worker-2", { branch: second.branch });
    git(root, "branch", "-D", first.branch);
    git(root, "branch", "-D", secondName);
  });

  it("旧分支仍被别处 worktree 占用时也不炸（换名新建，而不是 already checked out）", async () => {
    const root = repo();
    const first = await createWorktree(root, "worker-3", "同一任务");
    const elsewhere = mkdtempSync(join(tmpdir(), "cairn-wt-elsewhere-"));
    roots.push(elsewhere);
    const moved = join(elsewhere, "moved-wt");
    git(root, "worktree", "move", worktreePathFor(root, "worker-3"), moved);

    // 旧实现会 `git worktree add … <first.branch>` ⇒ fatal: already checked out
    const second = await createWorktree(root, "worker-3", "同一任务");
    expect(second.branch).not.toBe(first.branch);
    expect(second.baseCommit).toBe(head(root));

    await removeWorktree(root, "worker-3", { branch: second.branch });
    git(root, "worktree", "remove", "--force", moved);
    git(root, "branch", "-D", first.branch);
  });

  it("会话树显式要求复用：同 id 再建仍挂原分支（稳定身份语义不被 worker 的修法误伤）", async () => {
    const root = repo();
    const first = await createWorktree(root, "s-sess-1", "会话标题", [".agent"], { reuseExistingBranch: true });
    const second = await createWorktree(root, "s-sess-1", "会话标题", [".agent"], { reuseExistingBranch: true });
    expect(second.branch).toBe(first.branch);
    expect(second.baseCommit).toBe(head(root));
    expect(existsSync(worktreePathFor(root, "s-sess-1"))).toBe(true);
    await removeWorktree(root, "s-sess-1", { branch: second.branch });
  });

  it("撞名产生的 -2 分支也能被孤儿清理收走（自己造的债自己收）", async () => {
    const root = repo();
    const first = await createWorktree(root, "worker-9", "同一任务");
    const second = await createWorktree(root, "worker-9", "同一任务");
    expect(second.branch).toBe(first.branch.replace("-worker-9", "-2-worker-9"));
    expect(git(root, "branch", "--list", second.branch).trim()).not.toBe("");

    const cleaned = await cleanOrphanWorktree(root, "worker-9");
    expect(cleaned.removed).toBe(true);
    expect(git(root, "branch", "--list", first.branch).trim()).toBe("");
    expect(git(root, "branch", "--list", second.branch).trim()).toBe("");
  });


  it("同路径残留有未提交改动：拒绝 spawn，文件原样保留（不自动 rm -rf）", async () => {
    const root = repo();
    await createWorktree(root, "worker-7", "同一任务");
    const wt = worktreePathFor(root, "worker-7");
    writeFileSync(join(wt, "a.txt"), "dirty\n", "utf8");
    writeFileSync(join(wt, "wip.txt"), "uncommitted\n", "utf8");

    await expect(createWorktree(root, "worker-7", "同一任务")).rejects.toThrow(/未提交改动/);
    expect(readFileSync(join(wt, "a.txt"), "utf8")).toBe("dirty\n");
    expect(readFileSync(join(wt, "wip.txt"), "utf8")).toBe("uncommitted\n");

    // 手工清干净之后，自愈路径仍然可用（不是把整条重建封死）
    writeFileSync(join(wt, "a.txt"), "base\n", "utf8");
    rmSync(join(wt, "wip.txt"));
    const again = await createWorktree(root, "worker-7", "同一任务");
    expect(again.baseCommit).toBe(head(root));
  });

  it("同路径是认不出的普通目录：拒绝而不是删掉用户文件", async () => {
    const root = repo();
    const wt = worktreePathFor(root, "worker-8");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, "user.txt"), "keep me\n", "utf8");

    await expect(createWorktree(root, "worker-8", "同一任务")).rejects.toThrow(/不是可识别的 git worktree/);
    expect(readFileSync(join(wt, "user.txt"), "utf8")).toBe("keep me\n");
  });

});
