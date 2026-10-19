// v11 主界面批：git 两闸判卷（项目的"在场景"读数 + 克隆落盘）。
// 纯函数判卷 + 真 git 仓库行为（git init 造场；克隆的网络面不在判卷内——那用真机）。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitClone, gitStatus, isCloneableUrl, repoNameFromUrl } from "../src/main/git-ops";

const pexec = promisify(execFile);
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-git-ops-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("git-ops 纯函数", () => {
  it("URL 白名单：https/ssh/git@ 过；file://、本地路径、含空白拒", () => {
    expect(isCloneableUrl("https://github.com/foo/bar.git")).toBe(true);
    expect(isCloneableUrl("ssh://git@github.com/foo/bar.git")).toBe(true);
    expect(isCloneableUrl("git@github.com:foo/bar.git")).toBe(true);
    expect(isCloneableUrl("file:///Users/ze/x")).toBe(false);
    expect(isCloneableUrl("/Users/ze/x")).toBe(false);
    expect(isCloneableUrl("https://host/a b")).toBe(false);
    expect(isCloneableUrl("")).toBe(false);
  });

  it("仓库名：剥尾斜杠与 .git；认不出 = null", () => {
    expect(repoNameFromUrl("https://github.com/foo/bar.git")).toBe("bar");
    expect(repoNameFromUrl("git@github.com:foo/bar")).toBe("bar");
    expect(repoNameFromUrl("https://github.com/foo/bar/")).toBe("bar");
    expect(repoNameFromUrl("https://github.com/foo/")).toBe("foo");
    expect(repoNameFromUrl("git@github.com:foo/ba r")).toBe(null);
    expect(repoNameFromUrl("https://github.com/foo/bar@baz")).toBe(null);
  });
});

describe("git-ops 行为（真 git 仓库）", () => {
  it("新仓库：圆整分支名 + dirty 计数（无提交的 init 仓库也不报错）", async () => {
    const repo = join(root, "repo");
    await mkdir(repo);
    await pexec("git", ["-C", repo, "init", "-q"]);
    const clean = await gitStatus(repo);
    expect(clean.ok).toBe(true);
    if (clean.ok) {
      expect(typeof clean.branch).toBe("string"); // init 后 symbolic-ref 给缺省分支名
      expect(clean.dirtyFiles).toBe(0);
    }
    await writeFile(join(repo, "a.txt"), "x", "utf8");
    const dirty = await gitStatus(repo);
    expect(dirty.ok && dirty.dirtyFiles).toBe(1);
  });

  it("非仓库 = ok:false 且原因可辨；不存在的目录同样 ok:false（不抛）", async () => {
    const plain = join(root, "plain");
    await mkdir(plain);
    const r = await gitStatus(plain);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("不是 git 仓库");
    const missing = await gitStatus(join(root, "ghost"));
    expect(missing.ok).toBe(false);
  });

  it("clone：非法 URL / 目标已存在都被拒（不真联网）", async () => {
    const bad = await gitClone("file:///tmp/x", root);
    expect(bad.ok).toBe(false);
    const parent = join(root, "clones");
    await mkdir(parent);
    await mkdir(join(parent, "bar"));
    const exists = await gitClone("https://github.com/foo/bar.git", parent);
    expect(exists.ok).toBe(false);
    if (!exists.ok) expect(exists.error).toContain("已存在");
  });
});
