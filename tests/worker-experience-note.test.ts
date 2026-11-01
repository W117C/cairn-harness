import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Orchestrator, scriptedWorkerModel } from "../src/agent/orchestrator";
import { newExperience, type PlaybookOp } from "../src/agent/evolve/playbook";
import { appendPlaybookEvents } from "../src/main/evolve/playbook-store";
import { baselineEvolutionNote } from "../src/main/evolve/runtime";
import { evolveStopPathFor } from "../src/main/evolve/governance";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "worker-experience-"));
  roots.push(workspace);
  return workspace;
}

async function seed(workspace: string, status: "active" | "candidate" = "active"): Promise<string> {
  const entry = newExperience({
    id: "exp_0123456789abcdef",
    kind: "strategy",
    scope: { workspace },
    trigger: { when: "always" },
    body: "WORKER_LESSON：先读验收口径",
    status,
    evidenceEpisodes: ["ep_seed"],
    now: 1_000,
    expiresAt: null,
  });
  const op: PlaybookOp = { v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" };
  await appendPlaybookEvents(workspace, [op]);
  return entry.id;
}

describe("worker 起点经验注记", () => {
  it("只取 active；candidate/空库/冻结都返回空串", async () => {
    const active = await tempWorkspace();
    await seed(active);
    expect(await baselineEvolutionNote({ workspace: active, taskContent: "调研 a", toolNames: ["read_file"] }))
      .toContain("WORKER_LESSON");

    const candidate = await tempWorkspace();
    await seed(candidate, "candidate");
    expect(await baselineEvolutionNote({ workspace: candidate, taskContent: "调研 a", toolNames: ["read_file"] }))
      .toBe("");

    const frozen = await tempWorkspace();
    await seed(frozen);
    await mkdir(join(frozen, ".agent", "evolve"), { recursive: true });
    await writeFile(evolveStopPathFor(frozen), "", "utf8");
    expect(await baselineEvolutionNote({ workspace: frozen, taskContent: "调研 a", toolNames: ["read_file"] }))
      .toBe("");
  });

  it("真 Orchestrator：注记进 worker 的 system 消息，工具面按 worker 规格传入", async () => {
    const workspace = await tempWorkspace();
    const logPath = join(workspace, "events.jsonl");
    await writeFile(logPath, "", "utf8");
    const captured: import("../src/providers/glm").GlmMessage[][] = [];
    const seenToolNames: string[] = [];
    const model = () => scriptedWorkerModel([
      { type: "assistant_message", content: "## 结论\n- 查完了。" },
      { type: "usage", inputTokens: 1, outputTokens: 1 },
    ], captured);
    const orch = new Orchestrator({
      logPath,
      workspace,
      parentMode: "auto",
      emit: async () => undefined,
      modelFor: model,
      workerExperienceNote: async ({ task, mode, toolNames }) => {
        seenToolNames.push(...toolNames);
        return "WORKER_EXPERIENCE_NOTE(" + mode + "):" + task;
      },
    });
    const spawned = await orch.spawn({ mode: "read", task: "调研 a" }, { callId: "s1" });
    expect(spawned.ok).toBe(true);
    await orch.waitForAgents([], 10_000);
    expect(seenToolNames).toContain("read_file");
    expect(JSON.stringify(captured[0] ?? [])).toContain("WORKER_EXPERIENCE_NOTE(read):调研 a");
  });

  it("生产装配口默认接上该注记（行锚定）", async () => {
    const src = await readFile(fileURLToPath(new URL("../src/main/session-assembly.ts", import.meta.url)), "utf8");
    expect(src).toContain("workerExperienceNote: async ({ task, toolNames }) => {");
    expect(src).toContain("baselineEvolutionNote({");
  });
});
