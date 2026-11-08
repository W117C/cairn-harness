import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpPathFor, writeFileAtomic } from "../src/atomic-write";

let root = "";
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("writeFileAtomic", () => {
  it("临时名被预占为软链时 fail closed，不写穿到链接目标", async () => {
    root = await mkdtemp(join(tmpdir(), "atomic-symlink-"));
    const target = join(root, "settings.json");
    const victim = join(root, "victim.txt");
    await writeFile(victim, "original", "utf8");

    const at = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(at);
    const probe = tmpPathFor(target, at);
    const nextSeq = Number(probe.slice(probe.lastIndexOf("-") + 1)) + 1;
    await symlink(victim, target + ".tmp-" + String(process.pid) + "-" + String(at) + "-" + String(nextSeq));

    await expect(writeFileAtomic(target, "attacker-controlled")).rejects.toBeDefined();
    expect(await readFile(victim, "utf8")).toBe("original");
  });
});
