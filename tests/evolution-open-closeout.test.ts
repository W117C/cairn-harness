import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { extractSignals, type EvolutionSignals } from "../src/agent/evolution/signal";
import { tickCanaryFromSignals } from "../src/main/evolution/activation-host";
import { CanaryController, canaryLessonTopic, canaryRecordPathFor } from "../src/main/evolution/canary";
import { Installer } from "../src/main/evolution/installer";
import { ModuleRegistry } from "../src/main/evolution/registry";

const ID = "content-pack.closeout";
const GATES = new Set(["typecheck"]);
let root = "";

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "evolution-closeout-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const registry = (): ModuleRegistry => new ModuleRegistry(root, { knownGates: GATES });
const recordPath = (): string => canaryRecordPathFor(root, ID);
const readRecord = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(recordPath(), "utf8")) as Record<string, unknown>;
const ledgerPath = (): string => join(root, "modules", "registry.jsonl");
const lessonPath = (): string => join(root, ".agent", "memory", canaryLessonTopic(ID, "2.0.0") + ".md");

async function install(version: string): Promise<void> {
  const reg = registry();
  const dir = reg.stagingDir(ID, version);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify({
    id: ID, version, kind: "content-pack", permissions: [], gates: ["typecheck"],
  }));
  await writeFile(join(dir, "prompt.md"), "version " + version);
  await reg.registerStaged(ID, version, "evo-pipeline");
  await reg.recordGate(ID, version, "typecheck", true, "gate-runner");
  await new Installer(reg).installStaged({ id: ID, version, actor: "human", grants: new Set() });
}

async function begin(over: Parameters<CanaryController["begin"]>[0] = { id: ID }): Promise<void> {
  await install("1.0.0");
  await install("2.0.0");
  await new CanaryController({ registry: registry(), workspace: root }).begin({ maxSamples: 20, ...over });
}

/** Two completed work/verify pairs, with a separately measured tail after the last boundary. */
function measuredRun(tailTokens: number): EvolutionSignals {
  const events: AgentEvent[] = [{ type: "user_message", content: "finish two changes" }];
  for (const n of [1, 2]) {
    events.push(
      { type: "usage", inputTokens: 100, outputTokens: 0 },
      { type: "tool_call", id: "w" + n, name: "write_file", args: { path: "a" + n + ".ts" } },
      { type: "tool_result", callId: "w" + n, ok: true, output: "written" },
      { type: "tool_call", id: "v" + n, name: "verify", args: {} },
      { type: "verify_result", callId: "v" + n, ok: true, attempt: 1, maxAttempts: 1,
        results: [{ command: "test", ok: true, output: "passed" }] },
    );
  }
  events.push({ type: "usage", inputTokens: tailTokens, outputTokens: 0 });
  return extractSignals(events);
}

const missing = (): EvolutionSignals => extractSignals([
  { type: "user_message", content: "deliver artifact" },
  { type: "usage", inputTokens: 90_000, outputTokens: 0 },
]);
const red = (): EvolutionSignals => extractSignals([
  { type: "user_message", content: "verify" },
  { type: "tool_call", id: "red", name: "verify", args: {} },
  { type: "verify_result", callId: "red", ok: false, attempt: 1, maxAttempts: 1,
    results: [{ command: "test", ok: false, output: "regression" }], cause: "code" },
]);

/** Preserve valid bytes so repair restores the actual ledger, not a synthetic projection. */
async function corruptLedger(): Promise<string> {
  const clean = await readFile(ledgerPath(), "utf8");
  const lines = clean.trimEnd().split("\n");
  lines.splice(1, 0, "{ broken ledger line");
  await writeFile(ledgerPath(), lines.join("\n") + "\n");
  await rm(join(root, "modules", "registry.index.json"), { force: true });
  return clean;
}

async function repairLedger(clean: string): Promise<void> {
  await writeFile(ledgerPath(), clean);
  await rm(join(root, "modules", "registry.index.json"), { force: true });
}

const rollbackCount = async (): Promise<number> => (await readFile(ledgerPath(), "utf8")).trim().split("\n")
  .map((line) => JSON.parse(line) as { op: string }).filter((line) => line.op === "rollback").length;

describe("canary open issues: real workspace and production signal seam", () => {
  it("measurable tail above the baseline budget rolls back even when average cost is healthy", async () => {
    await begin({ id: ID, baselineTokensPerBoundary: 1_000 });
    const signals = measuredRun(2_100);
    expect(signals).toMatchObject({ costMeasurable: true, tokensPerBoundary: 1_150, spendAfterLastBoundary: 2_100 });
    const [tick] = await tickCanaryFromSignals(root, signals, "tail-regression");
    expect(tick).toMatchObject({ outcome: "resumed", acted: true,
      observation: { state: "rolled-back", rollbackTo: "1.0.0", degradations: [{ rule: "no-progress" }] } });
    expect((await registry().readIndex()).bundles[ID]?.active?.version).toBe("1.0.0");
    expect(await readFile(lessonPath(), "utf8")).toContain("tail-regression");
  });

  it("normal reply tails, the exact limit, missing baseline and missing measurement do not roll back", async () => {
    await begin({ id: ID, baselineTokensPerBoundary: 1_000 });
    for (const tail of [0, 1, 300, 2_000]) {
      const [tick] = await tickCanaryFromSignals(root, measuredRun(tail), "normal-" + tail);
      expect(tick?.observation).toMatchObject({ state: "observing", degradations: [] });
    }
    const [unmeasurable] = await tickCanaryFromSignals(root, missing(), "no-verify");
    expect(unmeasurable?.observation).toMatchObject({ state: "observing", degradations: [] });
    const saved = await readRecord();
    await writeFile(recordPath(), JSON.stringify({ ...saved, baselineTokensPerBoundary: null }));
    const [noBaseline] = await tickCanaryFromSignals(root, measuredRun(90_000), "no-baseline");
    expect(noBaseline?.observation).toMatchObject({ state: "observing", degradations: [] });
    expect((await registry().readIndex()).bundles[ID]?.active?.version).toBe("2.0.0");
  });

  it("the existing degradation factor controls the tail budget rather than a second hard-coded limit", async () => {
    await begin({ id: ID, baselineTokensPerBoundary: 1_000, costDegradeFactor: 3 });
    expect((await tickCanaryFromSignals(root, measuredRun(2_500), "within-three"))[0]?.observation)
      .toMatchObject({ state: "observing", degradations: [] });
    expect((await tickCanaryFromSignals(root, measuredRun(3_001), "above-three"))[0]?.observation)
      .toMatchObject({ state: "rolled-back", degradations: [{ rule: "no-progress" }] });
    expect((await registry().readIndex()).bundles[ID]?.active?.version).toBe("1.0.0");
  });

  it("none samples survive restarts without promotion; only fresh green samples fulfil the threshold", async () => {
    await begin({ id: ID, maxSamples: 2 });
    await tickCanaryFromSignals(root, missing(), "missing-1");
    const [missingAgain] = await tickCanaryFromSignals(root, missing(), "missing-2");
    expect(missingAgain?.observation).toMatchObject({ state: "observing", samples: 2, conclusiveSamples: 0 });
    const [one] = await tickCanaryFromSignals(root, measuredRun(0), "green-1");
    expect(one?.observation).toMatchObject({ state: "observing", samples: 3, conclusiveSamples: 1 });
    const [two] = await tickCanaryFromSignals(root, measuredRun(0), "green-2");
    expect(two?.observation).toMatchObject({ state: "promoted", samples: 4, conclusiveSamples: 2 });
  });

  it("ledger repair retries the original rollback across restarts exactly once without inventing samples", async () => {
    await begin({ id: ID, maxConsecutiveFailures: 1 });
    const clean = await corruptLedger();
    const [broken] = await tickCanaryFromSignals(root, red(), "original-failure");
    expect(broken?.observation).toMatchObject({ state: "degraded", samples: 1, consecutiveFailures: 1 });
    const failedLesson = await readFile(lessonPath(), "utf8");
    const [stillBroken] = await tickCanaryFromSignals(root, measuredRun(0), "not-new-evidence");
    expect(stillBroken).toMatchObject({ acted: false, observation: { state: "degraded", samples: 1 } });
    expect(await readFile(lessonPath(), "utf8")).toBe(failedLesson);
    await repairLedger(clean);
    const fresh = new CanaryController({ registry: registry(), workspace: root });
    await expect(fresh.begin({ id: ID })).rejects.toThrow(/没结案的观察记录/);
    expect(await fresh.openObservations()).toHaveLength(1);
    const [retried] = await tickCanaryFromSignals(root, measuredRun(0), "repair-run");
    expect(retried).toMatchObject({ acted: true, observation: { state: "rolled-back", samples: 1,
      consecutiveFailures: 1, conclusiveSamples: 1, rollbackTo: "1.0.0", rollbackRetryPending: false } });
    expect(retried?.observation?.rollbackError).toBeUndefined();
    expect(broken?.observation).toMatchObject({ rollbackRetryPending: true });
    expect((await registry().readIndex()).bundles[ID]?.active?.version).toBe("1.0.0");
    const correctedLesson = await readFile(lessonPath(), "utf8");
    expect(correctedLesson).toContain("已回退到 1.0.0");
    expect(correctedLesson).toContain("run=original-failure");
    expect(correctedLesson).not.toContain("repair-run");
    expect(await rollbackCount()).toBe(1);
    expect((await tickCanaryFromSignals(root, red(), "later"))[0]).toMatchObject({ outcome: "settled", acted: false });
    expect(await rollbackCount()).toBe(1);
    expect(await readFile(lessonPath(), "utf8")).toBe(correctedLesson);
  });

  it("a pending old rollback cannot replace a newer active candidate", async () => {
    await begin({ id: ID, maxConsecutiveFailures: 1 });
    const clean = await corruptLedger();
    await tickCanaryFromSignals(root, red(), "original-failure");
    await repairLedger(clean);
    await install("3.0.0");
    const [tick] = await tickCanaryFromSignals(root, measuredRun(0), "new-active");
    expect(tick).toMatchObject({ outcome: "idle", acted: false, observation: { state: "degraded", samples: 1 } });
    expect((await registry().readIndex()).bundles[ID]?.active?.version).toBe("3.0.0");
    expect(await rollbackCount()).toBe(0);
  });

  it("a changed previous pointer permanently refuses the old target instead of retrying settlement forever", async () => {
    await begin({ id: ID, maxConsecutiveFailures: 1 });
    const clean = await corruptLedger();
    await tickCanaryFromSignals(root, red(), "original-failure");
    await repairLedger(clean);
    await install("1.5.0");
    await registry().activate(ID, "2.0.0", "human");
    const [refused] = await tickCanaryFromSignals(root, measuredRun(0), "pointer-changed");
    expect(refused?.observation).toMatchObject({ state: "degraded", samples: 1, rollbackRetryPending: false });
    expect(refused?.observation?.rollbackError).toContain("previous 位现在是 1.5.0");
    const failureRecord = await readFile(recordPath(), "utf8");
    const failureLesson = await readFile(lessonPath(), "utf8");
    expect((await tickCanaryFromSignals(root, red(), "later"))[0]).toMatchObject({ outcome: "settled", acted: false });
    expect(await readFile(recordPath(), "utf8")).toBe(failureRecord);
    expect(await readFile(lessonPath(), "utf8")).toBe(failureLesson);
    expect((await registry().readIndex()).bundles[ID]?.active?.version).toBe("2.0.0");
    expect(await rollbackCount()).toBe(0);
  });

  it("no previous version is a terminal degradation and does not repeat settlement", async () => {
    await install("1.0.0");
    await new CanaryController({ registry: registry(), workspace: root }).begin({ id: ID, maxConsecutiveFailures: 1 });
    const [failed] = await tickCanaryFromSignals(root, red(), "no-previous");
    expect(failed?.observation).toMatchObject({ state: "degraded", samples: 1, previousVersion: null });
    const saved = await readFile(recordPath(), "utf8");
    expect((await tickCanaryFromSignals(root, red(), "again"))[0]).toMatchObject({ outcome: "settled", acted: false });
    expect(await readFile(recordPath(), "utf8")).toBe(saved);
    expect(await rollbackCount()).toBe(0);
  });

  it("pre-upgrade degraded records with a known ledger corruption error recover after repair", async () => {
    await begin({ id: ID, maxConsecutiveFailures: 1 });
    const clean = await corruptLedger();
    await tickCanaryFromSignals(root, red(), "old-failure");
    const old = await readRecord();
    delete old.rollbackRetryPending;
    delete old.degradationRunId;
    await writeFile(recordPath(), JSON.stringify(old));
    await repairLedger(clean);
    const [tick] = await tickCanaryFromSignals(root, measuredRun(0), "upgrade-run");
    expect(tick).toMatchObject({ acted: true, observation: { state: "rolled-back", samples: 1, rollbackTo: "1.0.0" } });
    expect((await registry().readIndex()).bundles[ID]?.active?.version).toBe("1.0.0");
    expect(await rollbackCount()).toBe(1);
    expect(await readFile(lessonPath(), "utf8")).toContain("run=unknown");
  });
});
