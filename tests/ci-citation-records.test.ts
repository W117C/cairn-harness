import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const pack = readFileSync(new URL("../archive/git-citation-records-2026-11-01.pack", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../archive/git-citation-records-2026-11-01.json", import.meta.url), "utf8")) as {
  packSha256: string; commits: string[];
};
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-citation-records-"));
  dirs.push(dir);
  expect(spawnSync("git", ["init", "--quiet", dir]).status).toBe(0);
  return dir;
}

it("CI can recover the original citation identities in an empty object database", () => {
  expect(createHash("sha256").update(pack).digest("hex")).toBe(manifest.packSha256);
  expect(new Set(manifest.commits).size).toBe(27);
  const cwd = repository();
  const restored = spawnSync("git", ["unpack-objects"], { cwd, input: pack });
  expect(restored.status, restored.stderr.toString()).toBe(0);
  const objects = spawnSync("git", ["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)"], { cwd, encoding: "utf8" });
  expect(objects.status).toBe(0);
  expect(objects.stdout.trim().split("\n").sort()).toEqual(manifest.commits.map((sha) => sha + " commit").sort());
  for (const sha of manifest.commits) {
    const raw = spawnSync("git", ["cat-file", "commit", sha], { cwd });
    expect(raw.status).toBe(0);
    const identity = createHash("sha1").update(Buffer.from("commit " + String(raw.stdout.length) + "\0")).update(raw.stdout).digest("hex");
    expect(identity).toBe(sha);
  }
});

it("a damaged archive fails recovery instead of certifying missing records", () => {
  const broken = Buffer.from(pack);
  broken[broken.length - 1] = broken[broken.length - 1]! ^ 1;
  const result = spawnSync("git", ["unpack-objects"], { cwd: repository(), input: broken });
  expect(result.status).not.toBe(0);
});
