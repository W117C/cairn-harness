// 会话 worktree 的“幂等”判卷（真跑 git）。
//
// 立项动因（2026-10-23 实测）：旧 `createSessionWorktree` 无条件走 `createWorktree`，
// 而后者开头就是 `git worktree remove --force` + `rm -rf` 同路径。于是重复点“隔离”
// 会把隔离树里**未提交的改动**整片删掉，还返回 ok:true——幂等的名义下藏着一次数据丢失。
// 这条判卷钉的是：已隔离 = 原样返回；坏树 = 拒绝并说清，绝不静默重建。
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionWorktree, sessionWorktreePath } from "../src/main/session-worktree";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const roots: string[] = [];
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-session-idem-"));
  roots.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "judge@example.com");
  git(dir, "config", "user.name", "judge");
  writeFileSync(join(dir, "a.txt"), "base\n", "utf8");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("createSessionWorktree：幂等 = 不动那棵树", () => {
  it("已隔离再调用：返回现状，未提交改动还在（旧实现会删掉并回 ok）", async () => {
    const root = repo();
    const first = await createSessionWorktree(root, "sess-idem-1", "标题");
    expect(first.ok).toBe(true);
    const wt = sessionWorktreePath(root, "sess-idem-1");
    writeFileSync(join(wt, "wip.txt"), "uncommitted work\n", "utf8");

    const second = await createSessionWorktree(root, "sess-idem-1", "标题");
    expect(second.ok).toBe(true);
    expect(second.branch).toBe(first.branch);
    expect(existsSync(join(wt, "wip.txt"))).toBe(true);
    expect(readFileSync(join(wt, "wip.txt"), "utf8")).toBe("uncommitted work\n");
  });

  it("目录在但不是可识别 worktree：拒绝并说清，不静默重建（不删用户文件）", async () => {
    const root = repo();
    const wt = sessionWorktreePath(root, "sess-idem-2");
    // 半截树：目录有文件，但 git 里没有这棵 worktree 的登记
    execFileSync("mkdir", ["-p", wt]);
    writeFileSync(join(wt, "user-file.txt"), "keep me\n", "utf8");

    const r = await createSessionWorktree(root, "sess-idem-2", "标题");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("不是可识别的 git worktree");
    expect(readFileSync(join(wt, "user-file.txt"), "utf8")).toBe("keep me\n");
  });
});
