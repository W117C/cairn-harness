import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { alwaysRulesPath, loadPermissionRules, loadWorkspacePermissionRules, readPermissionFile, savePermissionRules } from "../src/permissions/rules";

const renameGate = vi.hoisted(() => ({ path: "", claimed: false, signal: () => {}, wait: Promise.resolve() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (args[1] === renameGate.path && !renameGate.claimed) {
        renameGate.claimed = true;
        renameGate.signal();
        await renameGate.wait;
      }
      return actual.rename(...args);
    },
  };
});

const workspaces: string[] = [];
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), "permission-persistence-"));
  workspaces.push(path);
  return path;
}
afterEach(async () => {
  vi.restoreAllMocks();
  renameGate.path = "";
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("权限库写入与残留清理", () => {
  it("并发保存不能删除另一笔尚待 rename 的临时文件", async () => {
    const dir = await workspace();
    const path = join(dir, "permissions.json");
    let release = () => {};
    const ready = new Promise<void>((resolve) => { renameGate.signal = resolve; });
    renameGate.path = path;
    renameGate.claimed = false;
    renameGate.wait = new Promise<void>((resolve) => { release = resolve; });
    const first = savePermissionRules(path, [{ behavior: "allow", tool: "write_file", scope: "always" }])
      .then(() => null, (error: unknown) => error);
    try {
      await Promise.race([ready, first.then(() => { throw new Error("first save ended before rename"); })]);
      await savePermissionRules(path, [{ behavior: "deny", tool: "write_file", scope: "always" }]);
      release();
      expect(await first).toBeNull();
      expect(JSON.parse(await readFile(path, "utf8")).rules).toEqual([{ behavior: "allow", tool: "write_file", scope: "always" }]);
      expect(await readdir(dir)).toEqual(["permissions.json"]);
    } finally {
      release();
      await first;
    }
  });

  it.each(["ESRCH", "EPERM"] as const)("按写入进程状态处理现代残留，仍清理旧格式崩溃文件（%s）", async (code) => {
    const dir = await workspace();
    const path = join(dir, "permissions.json");
    const pid = 2 ** 30;
    const name = `permissions.json.tmp-${pid}-1-1`;
    await writeFile(join(dir, name), "pending write", "utf8");
    await writeFile(join(dir, "permissions.json.tmp-crash"), "incomplete legacy write", "utf8");
    const kill = process.kill.bind(process);
    vi.spyOn(process, "kill").mockImplementation((target, signal) => {
      if (target === pid && signal === 0) throw Object.assign(new Error(code), { code });
      return kill(target, signal);
    });

    await savePermissionRules(path, [{ behavior: "deny", tool: "write_file", scope: "always" }]);

    expect((await readdir(dir)).sort()).toEqual(code === "ESRCH" ? ["permissions.json"] : ["permissions.json", name]);
    expect(loadPermissionRules(path).map((rule) => rule.behavior)).toEqual(["deny"]);
  });
});

describe("授权文件不重复加载", () => {
  it("对工作区路径的等价拼法只加载一份授权", async () => {
    const dir = await workspace();
    const project = join(dir, "workspace");
    const appData = join(dir, "appdata");
    await mkdir(project);
    const path = alwaysRulesPath(project, appData);
    await savePermissionRules(path, [{ behavior: "allow", tool: "write_file", scope: "always" }]);
    for (const input of [project, project + "/."]) {
      expect(loadWorkspacePermissionRules(input, appData).map(({ tool, layer }) => ({ tool, layer })))
        .toEqual([{ tool: "write_file", layer: "local" }]);
    }
  });

  it("连续三次授权只保存三条记录，并继续支持从项目策略入口合并读取", async () => {
    const dir = await workspace();
    const project = join(dir, "workspace");
    const appData = join(dir, "appdata");
    await mkdir(project);
    const path = alwaysRulesPath(project, appData);
    for (const tool of ["write_file", "edit_file", "apply_patch"]) {
      await savePermissionRules(path, [...readPermissionFile(path), { behavior: "allow", tool, scope: "always" }]);
    }

    expect(JSON.parse(await readFile(path, "utf8")).rules.map((rule: { tool: string }) => rule.tool))
      .toEqual(["write_file", "edit_file", "apply_patch"]);
    expect(loadWorkspacePermissionRules(project, appData).map((rule) => rule.tool))
      .toEqual(["write_file", "edit_file", "apply_patch"]);
  });
});
