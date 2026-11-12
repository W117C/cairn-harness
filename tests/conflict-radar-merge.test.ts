// 语义冲突雷达的合并塔接线判卷（第 1074 页）：真 WorkerMergeReview，只把 git 层打桩。
// 四格：report 档只告警不拦、gate 档 same-symbol 拦（登记保留可重试）、force 可过、
// 图不可用 fail-open（不挡合并）；末格作零行为对照：无冲突时事件流只有合并回执。
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerMergeReview } from "../src/agent/worker-merge";
import type { AgentEvent } from "../src/events";
import type { WorkerHandle } from "../src/agent/orchestrator";
import type { ImpactGraph } from "../src/agent/impact/index";

const gitStub = vi.hoisted(() => ({
  commitAndMerge: async (): Promise<unknown> => ({ ok: true, mergeCommit: "abcdef1234567890" }),
  diffPatch: "",
}));
vi.mock("../src/agent/worktree", () => ({
  commitAndMerge: (...a: unknown[]) => gitStub.commitAndMerge(...(a as [])),
  removeWorktree: async () => ({ removed: true, branchDeleted: true }),
  worktreePathFor: (root: string, id: string) => root + "/wt-" + id,
  worktreeDiff: async () => ({ stat: "src/a.ts | 2 ++", patch: gitStub.diffPatch, files: ["src/a.ts"] }),
}));

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -0,0 +1,20 @@",
  "+x",
].join("\n");

function graphOf(): ImpactGraph {
  return {
    files: ["src/a.ts", "src/b.ts"],
    candidates: 2,
    cap: 400,
    defs: new Map([["foo", [{ symbol: "foo", file: "src/a.ts", line: 5 }]]]),
    refs: new Map(),
    edges: [],
    nameSources: new Map(),
    attribution: { kept: 0, dropped: 0, noEvidence: 0 },
    parsed: 0,
    fromTagsCache: 0,
  };
}

function writeWorker(id: string, files: string[]): WorkerHandle {
  return {
    agentId: id,
    mode: "write",
    worktree: "/repo/wt-" + id,
    branch: "agent/" + id,
    baseCommit: "1111111111111111111111111111111111111111",
    terminalResolved: true,
    finished: true,
    task: "改点东西",
    touchedFiles: new Set(files),
    lastFindings: [],
  } as unknown as WorkerHandle;
}

function harness(opts: {
  safeMode: "off" | "report" | "gate";
  mineFiles: string[];
  otherFiles?: string[];
  buildGraph?: () => Promise<ImpactGraph | null>;
  force?: boolean;
}): { wmr: WorkerMergeReview; owners: Set<string>; emitted: AgentEvent[] } {
  const owners = new Set<string>(["ag-1"]);
  const emitted: AgentEvent[] = [];
  const workers = new Map<string, WorkerHandle>([["ag-1", writeWorker("ag-1", opts.mineFiles)]]);
  const otherFiles = opts.otherFiles ?? [];
  if (otherFiles.length > 0) {
    workers.set("ag-2", writeWorker("ag-2", otherFiles));
    owners.add("ag-2");
  }
  const wmr = new WorkerMergeReview({
    opts: { emit: async (e) => { emitted.push(e); }, workspace: "/repo" },
    safeMode: opts.safeMode,
    workers,
    diffVersions: new Map(),
    hasMergeOwner: (id) => owners.has(id),
    dropMergeOwner: (id) => { owners.delete(id); },
    registerMergeOwner: (id) => { owners.add(id); },
    conflictRadar: { buildGraph: opts.buildGraph ?? (async () => graphOf()) },
    markAgentOwner: () => {},
    runWorker: async () => {},
    releaseWorkerMemory: () => {},
    rootSignal: new AbortController().signal,
  });
  return { wmr, owners, emitted };
}

afterEach(() => {
  gitStub.commitAndMerge = async () => ({ ok: true, mergeCommit: "abcdef1234567890" });
  gitStub.diffPatch = PATCH;
});

describe("雷达在合并塔的接线", () => {
  it("report 档：same-symbol 命中 ⇒ 落 [radar] 告警，但合并照走", async () => {
    gitStub.diffPatch = PATCH;
    const { wmr, emitted } = harness({ safeMode: "report", mineFiles: ["src/a.ts"], otherFiles: ["src/a.ts"] });
    const r = await wmr.mergeWorker("ag-1");
    expect(r.ok, r.error).toBe(true);
    const radarMsg = emitted.find((e) => e.type === "agent_message" && (e as { text: string }).text.startsWith("[radar]"));
    expect(radarMsg, "命中却没落 [radar] 告警").toBeDefined();
    expect((radarMsg as { text: string }).text).toContain("foo");
    expect(emitted.some((e) => e.type === "tool_result" && (e as { output: string }).output.startsWith("[merged]"))).toBe(true);
  });

  it("gate 档：same-symbol 未 force ⇒ 拦合并（ok:false ＋ [radar] 回执），登记保留可重试", async () => {
    gitStub.diffPatch = PATCH;
    let commits = 0;
    gitStub.commitAndMerge = async () => { commits += 1; return { ok: true }; };
    const { wmr, owners, emitted } = harness({ safeMode: "gate", mineFiles: ["src/a.ts"], otherFiles: ["src/a.ts"] });
    const r = await wmr.mergeWorker("ag-1");
    expect(r.ok).toBe(false);
    expect(commits, "被拦却已经合并了").toBe(0);
    expect(owners.has("ag-1"), "登记被摘 ⇒ force 重试会读成『未登记』").toBe(true);
    const receipt = emitted.find((e) => e.type === "tool_result" && !(e as { ok: boolean }).ok);
    expect((receipt as { output: string }).output.startsWith("[radar]")).toBe(true);
    expect((receipt as { output: string }).output).toContain("force");
  });

  it("gate 档 ＋ force ⇒ 放行（仍落告警）", async () => {
    gitStub.diffPatch = PATCH;
    let commits = 0;
    gitStub.commitAndMerge = async () => { commits += 1; return { ok: true }; };
    const { wmr } = harness({ safeMode: "gate", mineFiles: ["src/a.ts"], otherFiles: ["src/a.ts"] });
    const r = await wmr.mergeWorker("ag-1", { force: true });
    expect(r.ok, r.error).toBe(true);
    expect(commits).toBe(1);
  });

  it("图不可用（抛错）⇒ fail-open：合并照走，不落 [radar]", async () => {
    gitStub.diffPatch = PATCH;
    const { wmr, emitted } = harness({
      safeMode: "gate",
      mineFiles: ["src/a.ts"],
      otherFiles: ["src/a.ts"],
      buildGraph: async () => { throw new Error("ImpactUnavailableError: wasm missing"); },
    });
    const r = await wmr.mergeWorker("ag-1");
    expect(r.ok, r.error).toBe(true);
    expect(emitted.some((e) => e.type === "agent_message" && (e as { text: string }).text.startsWith("[radar]"))).toBe(false);
  });

  it("零行为对照：无并行改动面 ⇒ 事件流只有 [merged] 一条", async () => {
    gitStub.diffPatch = PATCH;
    const { wmr, emitted } = harness({ safeMode: "gate", mineFiles: ["src/a.ts"], otherFiles: [] });
    const r = await wmr.mergeWorker("ag-1");
    expect(r.ok, r.error).toBe(true);
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as { output: string }).output.startsWith("[merged]")).toBe(true);
  });
});
