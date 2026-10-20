// 会话级 worktree 隔离判卷（§3.7 · G4）：真跑 git，不 mock。
//
// 这一族的全部价值在**磁盘上真发生了什么**：树真建出来了、`.agent` 真链回主 checkout、
// 真能合并回去、冲突真会被 abort 回干净态、丢弃真把那棵树和分支清掉。
// 用假 git 去印证这些，等于把「我以为 git 会这样」写成判据——所以这里每条都在临时仓里跑真命令。
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSessionWorktree,
  discardSessionWorktree,
  isSessionIsolated,
  listIsolatedSessions,
  mergeSessionWorktree,
  sessionWorktreePath,
} from "../src/main/session-worktree";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** 一次性临时仓：一次提交 + 一个被跟踪文件 a.txt。 */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-session-wt-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "judge@example.com");
  git(dir, "config", "user.name", "judge");
  writeFileSync(join(dir, "a.txt"), "base\n", "utf8");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

describe("会话级 worktree 隔离（§3.7 · G4）", () => {
  it("创建：树真在盘上、`.agent` 真链回主 checkout、清单读得回来", async () => {
    const root = repo();
    expect(await isSessionIsolated(root, "sess-1")).toBe(false);

    const r = await createSessionWorktree(root, "sess-1", "标题");
    expect(r.ok).toBe(true);
    const wt = sessionWorktreePath(root, "sess-1");
    expect(r.path).toBe(wt);
    expect(existsSync(join(wt, "a.txt"))).toBe(true); // 从 HEAD 拉出来的完整 checkout
    // 配置/权限/记忆/会话根必须同源：`.agent` 是符号链接，指回主 checkout。
    expect(lstatSync(join(wt, ".agent")).isSymbolicLink()).toBe(true);
    expect(await isSessionIsolated(root, "sess-1")).toBe(true);
    expect(await listIsolatedSessions(root)).toEqual(["sess-1"]);
    // 幂等：再建一次不会炸（残留自愈在 createWorktree 里）
    expect((await createSessionWorktree(root, "sess-1", "标题")).ok).toBe(true);
  });

  it("合并：未提交改动先代为 commit，再 merge --no-ff 回主 checkout", async () => {
    const root = repo();
    const created = await createSessionWorktree(root, "sess-2");
    expect(created.ok).toBe(true);
    const wt = sessionWorktreePath(root, "sess-2");
    writeFileSync(join(wt, "a.txt"), "changed in worktree\n", "utf8");
    writeFileSync(join(wt, "b.txt"), "brand new\n", "utf8");

    const merged = await mergeSessionWorktree(root, "sess-2");
    expect(merged.ok).toBe(true);
    expect(merged.branch).toBe(created.branch);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("changed in worktree\n");
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("brand new\n");
    // merge --no-ff ⇒ 主分支上多一个合并提交，历史不被压平
    expect(git(root, "log", "--merges", "--oneline")).toContain("Merge branch");
    // 再合一次是空操作（树已干净），不该报错
    expect((await mergeSessionWorktree(root, "sess-2")).ok).toBe(true);
  });

  it("冲突：清单交得出来，主 checkout 被 abort 回干净态（不留半合并）", async () => {
    const root = repo();
    expect((await createSessionWorktree(root, "sess-3")).ok).toBe(true);
    const wt = sessionWorktreePath(root, "sess-3");
    // 两边改同一行
    writeFileSync(join(wt, "a.txt"), "from worktree\n", "utf8");
    writeFileSync(join(root, "a.txt"), "from main\n", "utf8");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "main side");

    const merged = await mergeSessionWorktree(root, "sess-3");
    expect(merged.ok).toBe(false);
    expect(merged.conflict).toBe(true);
    expect(merged.conflictedFiles).toEqual(["a.txt"]);
    // 关键：主 checkout 干净（abort 生效），用户的活还在隔离树里
    expect(git(root, "status", "--porcelain").trim()).toBe("");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("from main\n");
    expect(readFileSync(join(wt, "a.txt"), "utf8")).toBe("from worktree\n");
  });

  it("丢弃：树与分支一起清掉，且幂等（本来没有 = 已是干净态）", async () => {
    const root = repo();
    const created = await createSessionWorktree(root, "sess-4");
    expect(created.ok).toBe(true);
    const wt = sessionWorktreePath(root, "sess-4");
    writeFileSync(join(wt, "scratch.txt"), "wip\n", "utf8");

    expect(await discardSessionWorktree(root, "sess-4")).toEqual({ ok: true });
    expect(existsSync(wt)).toBe(false);
    expect(await isSessionIsolated(root, "sess-4")).toBe(false);
    expect(git(root, "branch", "--list", created.branch ?? "?").trim()).toBe("");
    expect(await discardSessionWorktree(root, "sess-4")).toEqual({ ok: true });
  });

  it("不合规的会话 id 当场拒（不静默改名——改名后按 id 就找不回自己那棵树）", async () => {
    const root = repo();
    const r = await createSessionWorktree(root, "a/b");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("git 分支名");
    expect(await isSessionIsolated(root, "a/b")).toBe(false);
  });
});
