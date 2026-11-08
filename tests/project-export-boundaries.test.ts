import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportProject } from "../src/main/project-export";

let root: string;
let source: string;
let parent: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cairn-export-boundaries-"));
  source = join(root, "source");
  parent = join(root, "exports");
  mkdirSync(source);
  mkdirSync(parent);
  writeFileSync(join(source, "actual.txt"), "portable result");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("project export boundaries", () => {
  it.each([".imported-project", "imported-" + "x".repeat(70)])("exports an existing folder without imposing new-project naming limits: %s", name => {
    const imported = join(root, name);
    renameSync(source, imported);
    const result = exportProject(imported, parent);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(readFileSync(join(result.dest, "actual.txt"), "utf8")).toBe("portable result");
  });

  it.each(["../escaped", "nested/export", ".", "..", "bad\\name"])("rejects a non-folder name: %s", name => {
    expect(exportProject(source, parent, { name })).toMatchObject({ ok: false, reason: "bad-source" });
    expect(readdirSync(parent)).toEqual([]);
    expect(existsSync(join(root, "escaped"))).toBe(false);
    expect(readFileSync(join(source, "actual.txt"), "utf8")).toBe("portable result");
  });

  it("rejects a destination inside the source before copying", () => {
    expect(exportProject(source, source, { name: "recursive-copy" }))
      .toMatchObject({ ok: false, reason: "bad-source" });
    expect(readdirSync(source)).toEqual(["actual.txt"]);
  });

  it.skipIf(process.platform === "win32")("resolves a parent symlink before checking source containment", () => {
    const alias = join(root, "source-alias");
    symlinkSync(source, alias, "dir");
    expect(exportProject(source, alias, { name: "recursive-copy" }))
      .toMatchObject({ ok: false, reason: "bad-source" });
    expect(readdirSync(source)).toEqual(["actual.txt"]);
  });

  it.skipIf(process.platform === "win32").each(["relative", "absolute"])(
    "keeps an internal %s symlink portable after the source is removed", kind => {
      symlinkSync(kind === "relative" ? "actual.txt" : join(source, "actual.txt"), join(source, "linked.txt"));
      const result = exportProject(source, parent, { name: "deliverable" });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(isAbsolute(readlinkSync(join(result.dest, "linked.txt")))).toBe(false);
      rmSync(source, { recursive: true });
      expect(readFileSync(join(result.dest, "linked.txt"), "utf8")).toBe("portable result");
    },
  );

  it.skipIf(process.platform === "win32")("rejects an external link and removes only the partial export", () => {
    const outside = join(root, "private.txt");
    writeFileSync(outside, "outside workspace");
    symlinkSync(outside, join(source, "external.txt"));
    expect(exportProject(source, parent, { name: "deliverable" })).toMatchObject({ ok: false });
    expect(readdirSync(parent)).toEqual([]);
    expect(readFileSync(outside, "utf8")).toBe("outside workspace");
  });

  it.skipIf(process.platform === "win32")("rejects a link whose target is excluded from delivery", () => {
    mkdirSync(join(source, ".agent"));
    writeFileSync(join(source, ".agent", "local.txt"), "local data");
    symlinkSync(".agent/local.txt", join(source, "linked.txt"));
    expect(exportProject(source, parent, { name: "deliverable" })).toMatchObject({ ok: false });
    expect(readdirSync(parent)).toEqual([]);
    expect(readFileSync(join(source, ".agent", "local.txt"), "utf8")).toBe("local data");
  });

  it.skipIf(process.platform === "win32")("a dangling destination link remains untouched", () => {
    const target = join(root, "missing");
    const dest = join(parent, "deliverable");
    symlinkSync(target, dest);
    expect(exportProject(source, parent, { name: "deliverable" })).toMatchObject({ ok: false, reason: "dest-exists" });
    expect(readlinkSync(dest)).toBe(target);
  });
});
