import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseBuildInfo } from "../src/main/build-info";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const script = pathToFileURL(resolve("apps/desktop/scripts/package.mjs")).href;
function runGit(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-build-source-"));
  dirs.push(dir);
  runGit(dir, "init", "-q");
  writeFileSync(join(dir, "entry.txt"), "original\n");
  runGit(dir, "add", "entry.txt");
  runGit(dir, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  return dir;
}
function provenance(dir: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `import { readSourceProvenance } from ${JSON.stringify(script)}; console.log(JSON.stringify(readSourceProvenance(process.argv[1])));`, dir], { encoding: "utf8" });
}

describe("打包来源", () => {
  it("先记录干净源码，再创建仓内暂存目录，构建产物不污染来源", () => {
    const dir = repository();
    const code = `import { preparePackageStaging, readSourceProvenance } from ${JSON.stringify(script)}; import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; const prepared = preparePackageStaging(process.argv[1], join(process.argv[1], 'apps/desktop/release')); writeFileSync(join(prepared.staging, 'artifact.txt'), 'built'); console.log(JSON.stringify({ before: prepared.sourceProvenance, after: readSourceProvenance(process.argv[1]) }));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, dir], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.before).toEqual({ sourceCommit: runGit(dir, "rev-parse", "HEAD"), sourceDirty: false });
    expect(data.after.sourceDirty).toBe(true);
  });

  it("记录完整 commit，并区分干净、已跟踪修改和未跟踪源码", () => {
    const dir = repository();
    const commit = runGit(dir, "rev-parse", "HEAD");
    const clean = provenance(dir);
    expect(clean.status, clean.stderr).toBe(0);
    expect(JSON.parse(clean.stdout)).toEqual({ sourceCommit: commit, sourceDirty: false });
    appendFileSync(join(dir, "entry.txt"), "changed\n");
    expect(JSON.parse(provenance(dir).stdout)).toEqual({ sourceCommit: commit, sourceDirty: true });
    runGit(dir, "checkout", "--", "entry.txt");
    writeFileSync(join(dir, "new-source.txt"), "new\n");
    expect(JSON.parse(provenance(dir).stdout)).toEqual({ sourceCommit: commit, sourceDirty: true });
  });

  it("不是 Git 仓时明确失败，不伪造来源", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-no-git-"));
    dirs.push(dir);
    const result = provenance(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("无法读取构建来源");
  });
});

const oldBuild = {
  version: "0.2.0", platform: "darwin", arch: "arm64", sourceLockSha256: "lock",
  packagedSmoke: "passed", signature: "ad-hoc", createdAt: "2026-11-01T00:00:00.000Z",
};
describe("旧包与工作树构建信息", () => {
  it("旧包保持兼容，新包保留 commit 与 dirty 状态", () => {
    expect(parseBuildInfo(oldBuild)).toEqual(oldBuild);
    const current = { ...oldBuild, sourceCommit: "a".repeat(40), sourceDirty: true };
    expect(parseBuildInfo(current)).toEqual(current);
  });

  it.each([
    { sourceCommit: "a".repeat(40) },
    { sourceDirty: false },
    { sourceCommit: "not-a-commit", sourceDirty: false },
    { sourceCommit: "a".repeat(40), sourceDirty: "false" },
  ])("拒绝不完整或错误的来源，不误报为干净提交：%j", (source) => {
    expect(parseBuildInfo({ ...oldBuild, ...source })).toBeNull();
  });
});
