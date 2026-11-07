// 只读 git 工具（git_read，2026-11-06 业主「完善工具层」第一批）的判卷面：
//  ① 行为三支：status/diff/log 在真 git 临时仓里各判一件；空仓/干净工作区的阴性要说清；
//  ② 安全面：op 白名单、path 越界拒、非 git 仓给可行动文案；
//  ③ 权限税 checklist（E 批的第一份）：非写向（SIDE_EFFECT_TOOLS 不收）、
//     全档模型可见（specs ⊇ 全 PERMISSION_MODES）、KNOWN_TOOL_NAMES 自动并集跟上。
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOOLS, ToolError, type ToolName } from "../src/tools";
import { git_read } from "../src/tools/git_read";
import { TOOL_NAMES } from "../src/tools/base";
import { isSideEffectTool, toolTableFor } from "../src/permissions";
import { PERMISSION_MODES } from "../src/permissions";
import { sessionToolSpecs } from "../src/agent/session-provider";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }, stdio: "pipe" });
}

async function repo(): Promise<{ dir: string; ctx: { workspace: string } }> {
  const dir = await mkdtemp(join(tmpdir(), "git-read-tool-"));
  dirs.push(dir);
  git(["init", "-q"], dir);
  return { dir, ctx: { workspace: dir } };
}

describe("git_read 行为面", () => {
  it("status：porcelain 清单带分支行；干净工作区阴性说清", async () => {
    const { dir, ctx } = await repo();
    await writeFile(join(dir, "a.ts"), "export const a = 1;\n", "utf8");
    git(["add", "."], dir);
    git(["commit", "-qm", "init"], dir);
    const clean = await git_read.run({ op: "status" }, ctx);
    expect(clean.ok).toBe(true);
    expect(clean.output).toContain("工作区干净");
    await writeFile(join(dir, "a.ts"), "export const a = 2;\n", "utf8");
    const dirty = await git_read.run({ op: "status" }, ctx);
    expect(dirty.ok).toBe(true);
    expect(dirty.output).toContain("M a.ts");
    expect(dirty.output).toContain("## ");
  });

  it("diff：未提交改动对 HEAD 的 hunk；path 收窄生效", async () => {
    const { dir, ctx } = await repo();
    await writeFile(join(dir, "a.ts"), "one\n", "utf8");
    git(["add", "."], dir);
    git(["commit", "-qm", "init"], dir);
    await writeFile(join(dir, "a.ts"), "two\n", "utf8");
    await writeFile(join(dir, "b.ts"), "new\n", "utf8");
    const all = await git_read.run({ op: "diff" }, ctx);
    expect(all.ok).toBe(true);
    expect(all.output).toContain("a.ts");
    // untracked（b.ts）不在 `diff HEAD` 里——这是 git 语义不是工具缺陷；「改了什么」的全貌走 status。
    expect(all.output).toContain("+two");
    const narrow = await git_read.run({ op: "diff", path: "a.ts" }, ctx);
    expect(narrow.ok).toBe(true);
    expect(narrow.output).toContain("a.ts");
    expect(narrow.output).not.toContain("b.ts");
  });

  it.each([
    ["diff", "diff.external"],
    ["status", "core.fsmonitor"],
    ["diff", "filter.trap.clean"],
    ["diff", "filter.trap.process"],
  ] as const)("%s 不执行仓库配置里的 %s", async (op, key) => {
    const { dir, ctx } = await repo();
    const name = "source.txt";
    await writeFile(join(dir, name), "old\n");
    await writeFile(join(dir, ".gitattributes"), "*.txt filter=trap\n");
    git(["add", "."], dir);
    git(["commit", "-qm", "base"], dir);
    await writeFile(join(dir, name), "new content\n");
    const marker = join(dir, "helper-ran");
    await writeFile(join(dir, "trap.sh"), "#!/bin/sh\nprintf 'ran' > " + JSON.stringify(marker) + "\nexit 0\n", { mode: 0o755 });
    await writeFile(join(dir, "included.gitconfig"), `[${key.split(".")[0]}${key.startsWith("filter.") ? ' "trap"' : ""}]\n${key.split(".").at(-1)} = ${JSON.stringify(join(dir, "trap.sh"))}\n`);
    git(["config", "include.path", join(dir, "included.gitconfig")], dir);
    const result = await git_read.run({ op }, ctx);
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    if (result.ok) expect(result.output).toContain(op === "diff" ? "+new content" : "M source.txt");
    else expect(result.output).toMatch(/filter|过滤器/i);
  });

  it("status 不把刷新后的文件时间写回索引", async () => {
    const { dir, ctx } = await repo();
    const source = join(dir, "a.ts");
    await writeFile(source, "old\n");
    const firstTime = new Date(Date.now() - 20_000);
    await utimes(source, firstTime, firstTime);
    git(["add", "."], dir);
    git(["commit", "-qm", "base"], dir);
    const index = join(dir, ".git", "index");
    const original = await readFile(index);
    const newTime = new Date(Date.now() - 10_000);
    await utimes(source, newTime, newTime);
    await expect(git_read.run({ op: "status" }, ctx)).resolves.toMatchObject({
      ok: true, output: expect.stringContaining("工作区干净"),
    });
    expect(await readFile(index)).toEqual(original);
  });

  it("log：最近 commit 单行清单；空仓阴性说清", async () => {
    const { dir, ctx } = await repo();
    const empty = await git_read.run({ op: "log" }, ctx);
    expect(empty.ok).toBe(true);
    expect(empty.output).toContain("空仓库");
    await writeFile(join(dir, "a.ts"), "x\n", "utf8");
    git(["add", "."], dir);
    git(["commit", "-qm", "c1"], dir);
    const log = await git_read.run({ op: "log" }, ctx);
    expect(log.ok).toBe(true);
    expect(log.output).toContain("c1");
  });

  it("安全面：未知 op 拒、path 越界拒、非 git 仓给可行动文案", async () => {
    const dir = await mkdtemp(join(tmpdir(), "git-read-tool-"));
    dirs.push(dir);
    const badOp = await git_read.run({ op: "push" }, { workspace: dir }).catch((e: unknown) => e);
    expect(badOp).toBeInstanceOf(ToolError);
    const { dir: gdir, ctx } = await repo();
    const badPath = await git_read.run({ op: "diff", path: "../outside" }, ctx).catch((e: unknown) => e);
    expect(badPath).toBeInstanceOf(ToolError);
    const nongit = await git_read.run({ op: "status" }, { workspace: dir });
    expect(nongit.ok).toBe(false);
    expect(nongit.output).toContain("不在 git 仓库内");
  });
});

describe("git_read 权限税 checklist（工具层地基判卷）", () => {
  it("非写向：isSideEffectTool=false，toolTableFor 四档都放行", () => {
    expect(isSideEffectTool("git_read")).toBe(false);
    for (const mode of PERMISSION_MODES) {
      expect(toolTableFor(mode)).toContain("git_read" as ToolName);
    }
  });

  it("注册表与名字表同源：TOOLS 里有、TOOL_NAMES 里有、执行器真在（不是只有说明书）", () => {
    expect(TOOLS.git_read).toBe(git_read);
    expect(TOOL_NAMES).toContain("git_read");
  });

  it("全档模型可见面：specs ⊇ git_read（含 read-only——只读档最需要它）", () => {
    for (const mode of PERMISSION_MODES) {
      const names = sessionToolSpecs({ mode }).specs.map((s) => s.function.name);
      expect(names).toContain("git_read");
    }
  });
});
