import { access, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectRegistry, ProjectRegistryCorruptError } from "../src/main/project-registry";

let root = "";
let registryPath = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-project-registry-"));
  registryPath = join(root, "user-data", "projects.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("CX-01 ProjectRegistry", () => {
  it("persists add/list atomically, stores canonical realpaths, and keeps removed disk content", async () => {
    const workspace = join(root, "workspace");
    const runLocation = join(workspace, ".worktrees", "main");
    const link = join(root, "workspace-link");
    await mkdir(runLocation, { recursive: true });
    await symlink(workspace, link, "dir");

    const registry = new ProjectRegistry(registryPath);
    const project = await registry.add({ name: "Forge", path: link, defaultLocation: runLocation });
    expect(project).toMatchObject({
      name: "Forge",
      path: await realpath(workspace),
      defaultLocation: await realpath(runLocation),
    });
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Number.isFinite(Date.parse(project.createdAt))).toBe(true);
    expect(Number.isFinite(Date.parse(project.updatedAt))).toBe(true);

    const reloaded = new ProjectRegistry(registryPath);
    expect(await reloaded.list()).toEqual([project]);
    const persistedDir = dirname(registryPath);
    expect((await readdir(persistedDir)).filter((name) => name.includes(".tmp-"))).toEqual([]);

    const removed = await reloaded.remove(project.id);
    expect(removed.removedAt).toEqual(expect.any(String));
    expect(await reloaded.list()).toEqual([]);
    expect((await reloaded.get(project.id)).removedAt).toBe(removed.removedAt);
    expect((await stat(workspace)).isDirectory()).toBe(true);
    expect((await stat(runLocation)).isDirectory()).toBe(true);

    // A removed registration can be restored without minting a second identity for the same path.
    const restored = await registry.add({ path: workspace });
    expect(restored.id).toBe(project.id);
    expect(restored.removedAt).toBeUndefined();
    expect(restored.name).toBe("Forge");
  });

  it("derives a truthful default name/location and serializes concurrent adds without losing records", async () => {
    const first = join(root, "first");
    const second = join(root, "second");
    await mkdir(first);
    await mkdir(second);
    const registry = new ProjectRegistry(registryPath);

    await Promise.all([
      registry.add({ path: first }),
      registry.add({ path: second }),
    ]);

    const listed = await registry.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((project) => project.name).sort()).toEqual([basename(first), basename(second)].sort());
    expect(listed.every((project) => project.path === project.defaultLocation)).toBe(true);
  });

  it("rejects relative, missing, non-directory, default-location, and name failures before persisting", async () => {
    const workspace = join(root, "workspace");
    const file = join(workspace, "not-a-directory");
    await mkdir(workspace);
    await writeFile(file, "x", "utf8");
    const registry = new ProjectRegistry(registryPath);

    await expect(registry.add({ path: "relative/path" })).rejects.toThrow(/绝对路径/);
    await expect(registry.add({ path: join(root, "missing") })).rejects.toThrow();
    await expect(registry.add({ path: file })).rejects.toThrow(/目录/);
    await expect(registry.add({ path: workspace, defaultLocation: "relative/run" })).rejects.toThrow(/绝对路径/);
    await expect(registry.add({ path: workspace, defaultLocation: file })).rejects.toThrow(/目录/);
    await expect(registry.add({ path: workspace, name: "  " })).rejects.toThrow(/名称/);
    await expect(registry.add({ path: workspace, name: "bad\nname" })).rejects.toThrow(/名称/);
    await expect(registry.add({ path: null as unknown as string })).rejects.toThrow(/path/);

    expect(await registry.list()).toEqual([]);
    await expect(access(registryPath)).rejects.toMatchObject({ code: "ENOENT" });

    const first = await registry.add({ path: workspace });
    // 同路径 upsert：桌面改名/改默认位置走的就是 addProject。
    const renamed = await registry.add({ path: workspace, name: "改名后的项目" });
    expect(renamed.id).toBe(first.id);
    expect(renamed.name).toBe("改名后的项目");
    expect(await registry.list()).toHaveLength(1);
  });

  it("uses an empty repository only when the file is absent; corrupt or malformed JSON fails closed", async () => {
    const missing = new ProjectRegistry(join(root, "missing", "projects.json"));
    expect(await missing.list()).toEqual([]);

    await mkdir(dirname(registryPath), { recursive: true });
    await writeFile(registryPath, "{ definitely-not-json", "utf8");
    const corrupt = new ProjectRegistry(registryPath);
    await expect(corrupt.list()).rejects.toBeInstanceOf(ProjectRegistryCorruptError);
    // 拒因与出路同屏（桌面「项目注册表不可用：…」原样显示这句）。
    await expect(corrupt.list()).rejects.toThrow(/修好或删除该文件后重试/);
    expect(await readFile(registryPath, "utf8")).toBe("{ definitely-not-json");

    await writeFile(
      registryPath,
      JSON.stringify({ version: 1, projects: { broken: { id: "broken", name: "x" } } }),
      "utf8",
    );
    await expect(corrupt.add({ path: root })).rejects.toBeInstanceOf(ProjectRegistryCorruptError);
  });

  // ---- v11：最近打开（lastOpenedAt / touch / recentFirst 排序）----
  it("add 即记 lastOpenedAt；touch 刷新它；旧文件（无该键）读取不炸", async () => {
    const a = join(root, "a");
    const b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const registry = new ProjectRegistry(registryPath);
    const rec = await registry.add({ path: a });
    expect(Number.isFinite(Date.parse(rec.lastOpenedAt ?? ""))).toBe(true);

    // touch 刷新（updatedAt 与 lastOpenedAt 同刻推进）
    const touched = await registry.touch(rec.id);
    expect(Number.isFinite(Date.parse(touched.lastOpenedAt ?? ""))).toBe(true);
    expect(Date.parse(touched.lastOpenedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(rec.lastOpenedAt ?? ""));

    // touch 未知 id = 抛（与 get 同口径）
    await expect(registry.touch("no-such-id")).rejects.toThrow(/不存在/);
    // 非法 id = 抛
    await expect(registry.touch("../evil")).rejects.toThrow(/非法/);

    // 旧格式文件（记录无 lastOpenedAt）读取不炸且字段缺席
    await registry.add({ path: b });
    const raw = JSON.parse(await readFile(registryPath, "utf8")) as { projects: Record<string, Record<string, unknown>> };
    for (const key of Object.keys(raw.projects)) delete raw.projects[key]!.lastOpenedAt;
    await writeFile(registryPath, JSON.stringify(raw), "utf8");
    const reloaded = await new ProjectRegistry(registryPath).list();
    expect(reloaded).toHaveLength(2);
    expect(reloaded.every((p) => p.lastOpenedAt === undefined)).toBe(true);
  });

  it("list recentFirst：按 lastOpenedAt ?? updatedAt 倒序（含已移除记录；默认排序不动）", async () => {
    const a = join(root, "ra");
    const b = join(root, "rb");
    const c = join(root, "rc");
    await mkdir(a);
    await mkdir(b);
    await mkdir(c);
    const registry = new ProjectRegistry(registryPath);
    const pa = await registry.add({ path: a });
    await new Promise((r) => setTimeout(r, 5)); // ms 级时间戳隔离（快照序不能靠同毫秒的竞态）
    const pb = await registry.add({ path: b });
    await new Promise((r) => setTimeout(r, 5));
    const pc = await registry.add({ path: c });
    await new Promise((r) => setTimeout(r, 5));
    await registry.touch(pa.id); // a 最新；c 次之（add 即记）；b 最旧
    await registry.remove(pc.id); // 软删除 ⇒ 默认 list 不见、recentFirst+includeRemoved 仍可列

    const recent = await registry.list({ includeRemoved: true, recentFirst: true });
    expect(recent.map((p) => p.id)).toEqual([pa.id, pc.id, pb.id]);

    const activeOnly = await registry.list({ recentFirst: true });
    expect(activeOnly.map((p) => p.id)).not.toContain(pc.id);
  });

  it("relocate 保住 id/name/createdAt，只换 path；defaultLocation 在旧树里就随迁", async () => {
    const oldRoot = join(root, "old-project");
    const oldSub = join(oldRoot, "sub");
    const newRoot = join(root, "new-project");
    await mkdir(oldSub, { recursive: true });
    const registry = new ProjectRegistry(registryPath);
    const project = await registry.add({ name: "Moved", path: oldRoot, defaultLocation: oldSub });
    await rename(oldRoot, newRoot);

    const relocated = await registry.relocate(project.id, newRoot);
    expect(relocated.id).toBe(project.id);
    expect(relocated.name).toBe("Moved");
    expect(relocated.createdAt).toBe(project.createdAt);
    expect(relocated.path).toBe(await realpath(newRoot));
    expect(relocated.defaultLocation).toBe(await realpath(join(newRoot, "sub")));
    expect(Number.isFinite(Date.parse(relocated.updatedAt))).toBe(true);
    // 持久化后重新加载仍是同一条（没有换 id、没有多出第二条）。
    const reloaded = new ProjectRegistry(registryPath);
    const listed = await reloaded.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(project.id);
    expect(listed[0]?.path).toBe(relocated.path);
  });

  it("defaultLocation 在旧树之外时原样保留（不替用户改他没动过的设置）", async () => {
    const projectDir = join(root, "project");
    const outside = join(root, "outside");
    await mkdir(projectDir);
    await mkdir(outside);
    const registry = new ProjectRegistry(registryPath);
    const project = await registry.add({ path: projectDir, defaultLocation: outside });
    const movedDir = join(root, "project-moved");
    await rename(projectDir, movedDir);

    const relocated = await registry.relocate(project.id, movedDir);
    expect(relocated.path).toBe(await realpath(movedDir));
    expect(relocated.defaultLocation).toBe(await realpath(outside));
  });

  it("relocate 拒绝不存在/非目录/被别的项目占用（含已移除记录）/已移除项目；同路径是幂等空操作", async () => {
    const a = join(root, "a");
    const b = join(root, "b");
    const file = join(root, "file.txt");
    await mkdir(a);
    await mkdir(b);
    await writeFile(file, "x", "utf8");
    const registry = new ProjectRegistry(registryPath);
    const pa = await registry.add({ path: a });
    const pb = await registry.add({ path: b });

    await expect(registry.relocate(pa.id, join(root, "missing"))).rejects.toThrow(/ENOENT|no such file/i);
    await expect(registry.relocate(pa.id, file)).rejects.toThrow(/不是目录/);
    await expect(registry.relocate(pa.id, b)).rejects.toThrow(/已被另一个项目登记/);
    await expect(registry.relocate("not-a-project", a)).rejects.toThrow(/项目不存在/);

    const removed = await registry.remove(pb.id);
    expect(removed.removedAt).toBeDefined();
    await expect(registry.relocate(pb.id, a)).rejects.toThrow(/已移除/);
    // 已移除记录占用的路径也不许被活动项目抢走（validateState 全量唯一）。
    await expect(registry.relocate(pa.id, b)).rejects.toThrow(/已移除/);

    // 同路径幂等：不改 updatedAt、不抛。
    const same = await registry.relocate(pa.id, a);
    expect(same.path).toBe(pa.path);
    expect(same.updatedAt).toBe(pa.updatedAt);
  });
});
