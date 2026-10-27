import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { write_file } from "../src/tools/write_file";
import { edit_file } from "../src/tools/edit_file";
import { apply_patch } from "../src/tools/apply_patch";

// Pause at the real mkdir boundary to make directory replacement deterministic.
const hooks = vi.hoisted(() => ({
  afterMkdir: undefined as ((path: unknown) => Promise<void>) | undefined,
  unreadable: "",
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
      const result = await fs.mkdir(...args);
      await hooks.afterMkdir?.(args[0]);
      return result;
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      if (hooks.unreadable && args[0] === hooks.unreadable) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return fs.open(...args);
    },
  };
});

let root = "";
afterEach(async () => {
  hooks.afterMkdir = undefined;
  hooks.unreadable = "";
  if (root) await rm(root, { recursive: true, force: true });
});

it.each(["write_file", "edit_file", "apply_patch"] as const)(
  "%s refuses a parent replaced by a link into .agent after the initial checks",
  async (tool) => {
    root = await mkdtemp(join(tmpdir(), "write-boundary-race-"));
    const parent = join(root, "notes");
    const system = join(root, ".agent");
    await mkdir(parent);
    await mkdir(system);
    await writeFile(join(parent, "config.json"), "original\n");
    await writeFile(join(system, "config.json"), "original\n");
    let replaced = false;
    hooks.afterMkdir = async (path) => {
      if (path !== parent || replaced) return;
      replaced = true;
      await rename(parent, join(root, "notes-original"));
      await symlink(system, parent);
    };
    const ctx = { workspace: root, snapshot: false };
    const run = tool === "write_file"
      ? write_file.run({ path: "notes/config.json", content: "changed\n" }, ctx)
      : tool === "edit_file"
        ? edit_file.run({ path: "notes/config.json", old_string: "original", new_string: "changed" }, ctx)
        : apply_patch.run({ patch: "diff --git a/notes/config.json b/notes/config.json\n--- a/notes/config.json\n+++ b/notes/config.json\n@@ -1 +1 @@\n-original\n+changed\n" }, ctx);
    await run.catch(() => undefined);
    expect(replaced).toBe(true);
    expect(await readFile(join(system, "config.json"), "utf8")).toBe("original\n");
  },
);

it("apply_patch refuses an unreadable existing target instead of treating it as absent", async () => {
  root = await mkdtemp(join(tmpdir(), "patch-unreadable-"));
  await writeFile(join(root, "existing.txt"), "preserve me\n");
  hooks.unreadable = await realpath(join(root, "existing.txt"));
  await expect(apply_patch.run({
    patch: "diff --git a/existing.txt b/existing.txt\n--- /dev/null\n+++ b/existing.txt\n@@ -0,0 +1 @@\n+overwrite\n",
  }, { workspace: root, snapshot: false })).rejects.toThrow(/不可读|permission denied/);
  expect(await readFile(hooks.unreadable, "utf8")).toBe("preserve me\n");
});
