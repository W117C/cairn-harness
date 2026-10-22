// 最小机制实验（2026-10-21）。首期接线后改为走生产缝：候选档案用 candidate-record，
// 收束用 activation-host.tickCanaryFromSignals。候选与任务仍是手写脚本化 demo，不发模型请求，
// 因此不证明任何能力收益。
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvolutionSignals } from "../../../src/agent/evolution/signal";
import { tickCanaryFromSignals } from "../../../src/main/evolution/activation-host";
import {
  digestFiles,
  readCandidateRecord,
  writeCandidateRecord,
  type CandidateRecord,
  type CandidateRun,
} from "../../../src/main/evolution/candidate-record";
import { CanaryController } from "../../../src/main/evolution/canary";
import { EvolutionPlane } from "../../../src/main/evolution/evolution-plane";
import { GateRunner } from "../../../src/main/evolution/gate-runner";
import { ModuleRegistry } from "../../../src/main/evolution/registry";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const KNOWN_GATES = new Set(["pack-check"]);
const PACK_ID = "content-pack.report-recipe";
const APPROVED_BY = "owner-human";
const TASK_SET = { id: "tiny-report", version: "1", digest: digestFiles({ "tiny-report.json": "handwritten-demo" }) };

type Transform = "baseline" | "good" | "bad";
type JudgeOutcome = "green" | "red" | "none";

function manifest(version: string): unknown {
  return {
    id: PACK_ID,
    version,
    kind: "content-pack",
    permissions: [],
    gates: ["pack-check"],
    title: "report recipe " + version,
    description: "scripted demo pack",
  };
}

function pack(version: string, transform: Transform): Record<string, string> {
  return {
    "recipe.json": JSON.stringify({ producerVersion: version, transform }, null, 2) + "\n",
    "README.md": "Scripted content pack for the evolution-kernel mechanism demo.\n",
  };
}

function signals(verifyOutcome: JudgeOutcome, runId: string): EvolutionSignals {
  return {
    verifyFailuresByCause: verifyOutcome === "red" ? { code: 1 } : {},
    lastVerifyFailureCause: verifyOutcome === "red" ? "code" : null,
    repeatedVerifyCause: null,
    verifyOutcome,
    goalDriftCount: 0,
    goalDriftMeasurable: false,
    costMeasurable: false,
    tokensPerBoundary: null,
    spendAfterLastBoundary: 0,
    eventCount: 3,
  };
}

function registryOf(ws: string): ModuleRegistry {
  return new ModuleRegistry(ws, { knownGates: KNOWN_GATES });
}

function gateRunnerFor(registry: ModuleRegistry, ws: string, version: string): GateRunner {
  return new GateRunner({
    registry,
    cwd: ws,
    runGate: async (gate) => {
      if (gate !== "pack-check") return { code: 127, output: "unknown gate: " + gate };
      const dir = registry.stagingDir(PACK_ID, version);
      const r = spawnSync(process.execPath, [join(HERE, "check-pack.mjs"), dir], { encoding: "utf8" });
      return { code: r.status ?? 1, output: (r.stdout ?? "") + (r.stderr ?? "") };
    },
  });
}

function consumerRun(ws: string, label: string): { artifact: unknown; producerVersion?: string; exit: number } {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(HERE, "consumer.ts"), ws, label], { encoding: "utf8" });
  const line = (r.stdout ?? "").trim().split("\n").filter(Boolean).pop();
  let parsed: { artifact?: unknown; producerVersion?: string } = {};
  try {
    parsed = JSON.parse(line ?? "{}") as typeof parsed;
  } catch {
    parsed = {};
  }
  return {
    artifact: parsed.artifact,
    ...(parsed.producerVersion !== undefined ? { producerVersion: parsed.producerVersion } : {}),
    exit: r.status ?? 1,
  };
}

function judgeRun(ws: string, label: string): { ok: boolean; exit: number; raw: string; producerVersion?: string } {
  const r = spawnSync(process.execPath, [join(HERE, "judge.mjs"), ws, label], { encoding: "utf8" });
  const raw = ((r.stdout ?? "") + (r.stderr ?? "")).trim();
  let parsed: { ok?: boolean; producerVersion?: string } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    parsed = {};
  }
  return {
    ok: parsed.ok === true,
    exit: r.status ?? 1,
    raw,
    ...(parsed.producerVersion !== undefined ? { producerVersion: parsed.producerVersion } : {}),
  };
}

async function submit(plane: EvolutionPlane, version: string, transform: Transform): Promise<void> {
  const receipt = await plane.submitProposal({ manifest: manifest(version), files: pack(version, transform) });
  console.log("[exp] submitted " + receipt.id + "@" + receipt.version + " staging=" + receipt.stagingDir);
}

function runOf(version: string, taskId: string, ok: boolean | null, artifactDigest: string | null, failureReason: string | null): CandidateRun {
  return {
    runId: version + ":" + taskId,
    taskId,
    split: "search",
    ok,
    costUsd: 0,
    tokens: 0,
    durationMs: 0,
    artifactDigest,
    failureReason,
  };
}

async function writeRecord(
  ws: string,
  version: string,
  parentVersion: string,
  transform: Transform,
  evaluation: CandidateRecord["evaluation"],
  runs: CandidateRun[],
  rollbackTo: string | null = null,
): Promise<void> {
  const record: CandidateRecord = {
    schema: 1,
    id: PACK_ID,
    version,
    parentVersion,
    contentDigest: digestFiles(pack(version, transform)),
    generator: { kind: "handwritten-demo", model: null, tools: [] },
    taskSet: TASK_SET,
    env: { commit: null, node: process.version, configDigest: null },
    runs,
    evaluation,
    approvals: { approvedBy: APPROVED_BY, at: new Date().toISOString() },
    rollbackTo,
    createdAt: new Date().toISOString(),
  };
  await writeCandidateRecord(ws, record);
}

async function phase1(ws: string): Promise<void> {
  await mkdir(join(ws, "artifacts"), { recursive: true });
  await writeFile(
    join(ws, "input.json"),
    JSON.stringify({ title: "Quarterly report", sources: [{ id: "s2" }, { id: "s1" }] }, null, 2) + "\n",
    "utf8",
  );
  const registry = registryOf(ws);
  const plane = new EvolutionPlane({ registry, requiredGatesByKind: { "content-pack": ["pack-check"] } });

  // 基线 1.0.0：提交 → 门 → 安装（无 previous）。
  await submit(plane, "1.0.0", "baseline");
  console.log("[exp] gates 1.0.0 => " + JSON.stringify(await gateRunnerFor(registry, ws, "1.0.0").runDeclaredGates(PACK_ID, "1.0.0")));
  await plane.installApprovedProposal(PACK_ID, "1.0.0", { approvedBy: APPROVED_BY });
  const base = consumerRun(ws, "baseline");
  const baseJudge = judgeRun(ws, "baseline");
  console.log("[exp] baseline artifact producer=" + String(base.producerVersion) + " judge=" + baseJudge.raw);

  // 候选 A（1.1.0）：应通过。
  await submit(plane, "1.1.0", "good");
  console.log("[exp] gates 1.1.0 => " + JSON.stringify(await gateRunnerFor(registry, ws, "1.1.0").runDeclaredGates(PACK_ID, "1.1.0")));
  await plane.installApprovedProposal(PACK_ID, "1.1.0", { approvedBy: APPROVED_BY });
  const good = consumerRun(ws, "good");
  const goodJudge = judgeRun(ws, "good");
  console.log("[exp] candidate 1.1.0 artifact producer=" + String(good.producerVersion) + " judge=" + goodJudge.raw);

  const canaryGood = new CanaryController({ registry, workspace: ws });
  console.log("[exp] canary begin 1.1.0 => " + JSON.stringify(await canaryGood.begin({ id: PACK_ID, maxSamples: 1, maxConsecutiveFailures: 2 })));
  const goodTick = await tickCanaryFromSignals(ws, signals(goodJudge.ok ? "green" : "red", "run-good-1"), "run-good-1");
  console.log("[exp] canary tick 1.1.0 => " + JSON.stringify(goodTick));
  await writeRecord(ws, "1.1.0", "1.0.0", "good", {
    status: goodJudge.ok ? "passed" : "failed",
    decision: goodJudge.ok ? "promote" : "keep-old",
    reason: goodJudge.ok ? "scripted demo: correctness passed" : "scripted demo: judge red",
  }, [runOf("1.1.0", "tiny-report", goodJudge.ok, digestFiles({ "artifact.json": JSON.stringify(good.artifact) }), goodJudge.ok ? null : goodJudge.raw)]);

  // 候选 B（1.2.0）：故意退化。先证明「没有门证据时安装被拒」，再补门、安装、观察。
  await submit(plane, "1.2.0", "bad");
  await writeRecord(ws, "1.2.0", "1.1.0", "bad", { status: "pending", decision: "pending", reason: null }, []);
  try {
    await plane.installApprovedProposal(PACK_ID, "1.2.0", { approvedBy: APPROVED_BY });
    console.log("[exp] UNEXPECTED: 1.2.0 installed without gates");
  } catch (err) {
    console.log("[exp] missing-evidence install refused => " + (err instanceof Error ? err.name + ": " + err.message : String(err)));
  }
  console.log("[exp] gates 1.2.0 => " + JSON.stringify(await gateRunnerFor(registry, ws, "1.2.0").runDeclaredGates(PACK_ID, "1.2.0")));
  await plane.installApprovedProposal(PACK_ID, "1.2.0", { approvedBy: APPROVED_BY });

  const bad = consumerRun(ws, "bad");
  const badJudge = judgeRun(ws, "bad");
  console.log("[exp] candidate 1.2.0 artifact producer=" + String(bad.producerVersion) + " judge=" + badJudge.raw);

  const canaryBad = new CanaryController({ registry, workspace: ws });
  console.log("[exp] canary begin 1.2.0 => " + JSON.stringify(await canaryBad.begin({ id: PACK_ID, maxSamples: 10, maxConsecutiveFailures: 2 })));
  const red1 = await tickCanaryFromSignals(ws, signals("red", "run-bad-1"), "run-bad-1");
  console.log("[exp] canary tick 1.2.0 red#1 => " + JSON.stringify(red1));
  const none = await tickCanaryFromSignals(ws, signals("none", "run-bad-2-none"), "run-bad-2-none");
  console.log("[exp] canary tick 1.2.0 none#2 => " + JSON.stringify(none));
  console.log("[exp] phase1 done; canary record on disk = " + canaryBad.recordPathOf(PACK_ID));
}

async function phase2(ws: string): Promise<void> {
  const tick = await tickCanaryFromSignals(ws, signals("red", "run-bad-3-after-restart"), "run-bad-3-after-restart");
  console.log("[exp] restart tick 1.2.0 red#3 => " + JSON.stringify(tick));

  const registry = registryOf(ws);
  const index = await registry.readIndex();
  const entry = index.bundles[PACK_ID];
  console.log("[exp] registry after rollback: active=" + String(entry?.active?.version) + " previous=" + String(entry?.previous?.version));
  const restored = consumerRun(ws, "restored");
  const restoredJudge = judgeRun(ws, "restored");
  console.log("[exp] restored artifact producer=" + String(restored.producerVersion) + " judge=" + restoredJudge.raw);

  const record = await readCandidateRecord(ws, PACK_ID, "1.2.0");
  if (record === null) throw new Error("1.2.0 candidate record missing");
  record.runs = [
    runOf("1.2.0", "tiny-report", false, digestFiles({ "artifact.json": JSON.stringify(restored.artifact) }), "judge red"),
    runOf("1.2.0", "tiny-report:none", null, null, "no evidence (none)"),
    runOf("1.2.0", "tiny-report:after-restart", false, null, "consecutive failure limit"),
  ];
  record.evaluation = { status: "rolled-back", decision: "keep-old", reason: "consecutive-failures" };
  record.rollbackTo = "1.1.0";
  await writeCandidateRecord(ws, record);
}

const phase = process.argv[2];
const ws = process.argv[3];
if (phase === undefined || ws === undefined) {
  console.error("usage: run.ts <phase1|phase2> <workspace>");
  process.exit(2);
}
if (phase === "phase1") await phase1(ws);
else if (phase === "phase2") await phase2(ws);
else {
  console.error("unknown phase: " + phase);
  process.exit(2);
}
console.log("[exp] repo root = " + REPO);
