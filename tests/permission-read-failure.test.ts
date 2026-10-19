import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { alwaysRulesPath, loadPermissionRules } from "../src/permissions/rules";

const failure = vi.hoisted(() => ({ path: "", code: "" }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === failure.path) throw Object.assign(new Error("read failed"), { code: failure.code });
      return fs.readFileSync(...args);
    },
  };
});

const temporaryDirs: string[] = [];
afterEach(async () => {
  failure.path = "";
  failure.code = "";
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "permission-read-failure-"));
  temporaryDirs.push(dir);
  const project = join(dir, ".agent", "permissions.json");
  const global = join(dir, "global.json");
  const always = alwaysRulesPath(dir);
  await mkdir(join(dir, ".agent"), { recursive: true });
  const deny = { behavior: "deny", tool: "write_file", scope: "always" };
  for (const path of [project, global, always]) await writeFile(path, JSON.stringify({ rules: [deny] }));
  return { dir, project, global, always };
}

describe("权限库读取失败必须拒载", () => {
  it.each(["project", "global", "always"] as const)("%s 层的 EACCES 不得当成缺文件", async (layer) => {
    const paths = await setup();
    failure.path = paths[layer];
    failure.code = "EACCES";
    expect(() => loadPermissionRules(paths.project, paths.global)).toThrow(/权限库读取失败.*拒载/);
    expect(() => loadPermissionRules(paths.project, paths.global)).toThrow(paths[layer]);
  });

  it("I/O 错误也必须报告，不得丢掉已有 deny 继续运行", async () => {
    const paths = await setup();
    failure.path = paths.global;
    failure.code = "EIO";
    expect(() => loadPermissionRules(paths.project, paths.global)).toThrow(/权限库读取失败.*拒载/);
  });

  it.each(["project", "global", "always"] as const)("%s 规则路径被目录占用时拒载（真实文件系统）", async (layer) => {
    const paths = await setup();
    await rm(paths[layer]);
    await mkdir(paths[layer]);
    expect(() => loadPermissionRules(paths.project, paths.global)).toThrow(/权限库读取失败.*拒载/);
  });

  it("父路径不是目录时也拒载（真实文件系统）", async () => {
    const paths = await setup();
    await rm(join(paths.dir, ".agent"), { recursive: true });
    await writeFile(join(paths.dir, ".agent"), "not a directory");
    expect(() => loadPermissionRules(paths.project, paths.global)).toThrow(/权限库读取失败.*拒载/);
  });

  it("真正不存在的文件仍可缺省，另一层的 deny 保留", async () => {
    const paths = await setup();
    const missing = join(paths.dir, "missing", "permissions.json");
    expect(loadPermissionRules(missing, paths.global)).toMatchObject([{ behavior: "deny", layer: "global" }]);
    expect(loadPermissionRules(missing, missing)).toEqual([]);
  });
});
