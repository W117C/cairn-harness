import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistEvolution } from "../src/agent/evolution";
import { newExperience, type ExperienceEntry, type PlaybookOp } from "../src/agent/evolve/playbook";
import {
  appendPlaybookEvents,
  loadPlaybook,
  playbookIndexPathFor,
  playbookPathFor,
  seedPlaybookFromLegacy,
  writePlaybookIndex,
} from "../src/main/evolve/playbook-store";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "evolve-playbook-"));
  workspaces.push(workspace);
  return workspace;
}

function addOp(entry: ExperienceEntry, evidence: string[] = []): PlaybookOp {
  return { v: 1, op: "add", ts: 1_000, entry, evidence, reason: "test" };
}

describe("Playbook 存储", () => {
  it("追加式落盘；坏行只丢一条；语义拒单进 refusals", async () => {
    const workspace = await tempWorkspace();
    const first = newExperience({
      kind: "warning", scope: { workspace }, trigger: { when: "always" }, body: "先看路径", now: 1_000,
    });
    const second = newExperience({
      kind: "strategy", scope: { workspace }, trigger: { when: "always" }, body: "先读再改", now: 1_000,
    });
    await appendPlaybookEvents(workspace, [addOp(first), addOp(second)]);

    const path = playbookPathFor(workspace);
    await writeFile(path, (await readFile(path, "utf8")) + "{bad json}\n", "utf8");
    let loaded = await loadPlaybook(workspace);
    expect(loaded.entries).toHaveLength(2);
    expect(loaded.badLines).toBe(1);
    expect(loaded.refusals).toEqual([]);

    const noEvidence = newExperience({
      kind: "warning", scope: { workspace }, trigger: { when: "always" }, body: "无证据", status: "active", now: 1_000,
    });
    await appendPlaybookEvents(workspace, [addOp(first), addOp(noEvidence)]);
    loaded = await loadPlaybook(workspace);
    expect(loaded.entries).toHaveLength(2);
    expect(loaded.refusals).toHaveLength(2);
    expect(loaded.refusals.map((item) => item.reason)).toEqual([
      "同 id 已存在（版本不可变，修改走 patch）",
      "active 必须有至少一条 Episode 证据",
    ]);
  });

  it("从 evolution.json / lessons / workflows 迁移为 candidate，且幂等", async () => {
    const workspace = await tempWorkspace();
    await mkdir(join(workspace, ".agent", "memory"), { recursive: true });
    await persistEvolution(workspace, [
      { kind: "verify-escalate", cause: "code", times: 3, note: "同一 cause 连败，先换诊断路径" },
    ], "s1");
    await writeFile(
      join(workspace, ".agent", "memory", "MEMORY.md"),
      [
        "- lesson-verify-red-1 · project · 2026-10-27T00:00:00.000Z · d1",
        "- workflow-abc12345 · project · 2026-10-27T00:00:00.000Z · d2",
      ].join("\n") + "\n",
      "utf8",
    );
    const front = "---\ntype: project\nmodified: 2026-10-27T00:00:00.000Z\n---\n";
    await writeFile(join(workspace, ".agent", "memory", "lesson-verify-red-1.md"), front + "验证红了先看失败输出，不要重复同一改动\n", "utf8");
    await writeFile(join(workspace, ".agent", "memory", "workflow-abc12345.md"), front + "read_file -> edit_file -> run_shell\n", "utf8");

    const first = await seedPlaybookFromLegacy(workspace, { now: 2_000 });
    expect(first.proposed).toBe(3);
    expect(first.added).toBe(3);
    expect(first.skippedExisting).toBe(0);
    expect(first.skippedInvalid).toBe(0);

    const loaded = await loadPlaybook(workspace);
    expect(loaded.entries).toHaveLength(3);
    expect(loaded.entries.every((entry) => entry.status === "candidate")).toBe(true);
    expect(loaded.entries.every((entry) => entry.provenance.generator === "legacy")).toBe(true);
    expect(loaded.entries.filter((entry) => entry.kind === "warning")).toHaveLength(2);
    expect(loaded.entries.filter((entry) => entry.kind === "strategy")).toHaveLength(1);

    const second = await seedPlaybookFromLegacy(workspace, { now: 3_000 });
    expect(second.added).toBe(0);
    expect(second.skippedExisting).toBe(3);

    const index = await writePlaybookIndex(workspace);
    expect(index.path).toBe(playbookIndexPathFor(workspace));
    const parsed = JSON.parse(await readFile(index.path, "utf8")) as { v: number; entries: unknown[] };
    expect(parsed.v).toBe(1);
    expect(parsed.entries).toHaveLength(3);
  });

  it("没有旧料时迁移为零，不建文件", async () => {
    const workspace = await tempWorkspace();
    const result = await seedPlaybookFromLegacy(workspace, { now: 1_000 });
    expect(result).toMatchObject({ proposed: 0, added: 0, skippedExisting: 0, skippedInvalid: 0 });
    expect((await loadPlaybook(workspace)).entries).toEqual([]);
  });
});
