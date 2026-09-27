import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
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

    await registry.add({ path: workspace });
    await expect(registry.add({ path: workspace })).rejects.toThrow(/已注册/);
  });

  it("uses an empty repository only when the file is absent; corrupt or malformed JSON fails closed", async () => {
    const missing = new ProjectRegistry(join(root, "missing", "projects.json"));
    expect(await missing.list()).toEqual([]);

    await mkdir(dirname(registryPath), { recursive: true });
    await writeFile(registryPath, "{ definitely-not-json", "utf8");
    const corrupt = new ProjectRegistry(registryPath);
    await expect(corrupt.list()).rejects.toBeInstanceOf(ProjectRegistryCorruptError);
    expect(await readFile(registryPath, "utf8")).toBe("{ definitely-not-json");

    await writeFile(
      registryPath,
      JSON.stringify({ version: 1, projects: { broken: { id: "broken", name: "x" } } }),
      "utf8",
    );
    await expect(corrupt.add({ path: root })).rejects.toBeInstanceOf(ProjectRegistryCorruptError);
  });
});
