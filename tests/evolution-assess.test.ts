// 闭环 v2 批次 C2 判卷：周期 Assess（三路喂料折报告 + gated-auto 执行面）。
// 反向验证：门没全绿不进待办、已激活的 bundle 不进待办、manual 档一个指头不动、
// 账本读不动不出报告、无 cost 读数不编基线。
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { assess, assessReportPathFor, runAssess, type AssessInputs } from "../src/main/evolution/assess";
import { autoInstallEligible } from "../src/main/evolution/autonomy";
import { appendLedger } from "../src/agent/evolution/ledger";
import type { LedgerKeyStats } from "../src/agent/evolution/ledger";
import { GATES } from "../scripts/gate-manifest";
import { ModuleRegistry } from "../src/main/evolution/registry";
import type { BundleEntry, RegistryIndex } from "../src/main/evolution/registry";

const emptyIndex = (): Pick<RegistryIndex, "bundles"> => ({ bundles: {} });

const entry = (over: Partial<BundleEntry> = {}): BundleEntry => ({
  kind: "content-pack",
  versions: {
    "0.1.0": {
      registeredAt: "2026-10-25T00:00:00Z",
      kind: "content-pack",
      permissions: [],
      declaredGates: ["typecheck"],
      gates: { typecheck: "pass" },
    },
  },
  ...over,
});

const stats = (key: string, streak: number): LedgerKeyStats => ({
  key, kind: "cost-throttle", emitted: streak, resolved: 0, recurred: streak, inconclusive: 0,
  recurrenceStreak: streak, lastStatus: "recurred", lastTs: 1,
});

const inputs = (over: Partial<AssessInputs> = {}): AssessInputs => ({
  index: emptyIndex(),
  patchStats: {},
  workflowHits: [],
  canaryFindings: [],
  registeredWorkflowIds: new Set<string>(),
  ...over,
});

describe("assess（纯判定）", () => {
  it("gated-auto：全门绿的零权限 content-pack staged 版本 ⇒ 自动安装候选", () => {
    const report = assess(inputs({ index: { bundles: { "content-pack.demo": entry() } } }), "gated-auto", 1);
    expect(report.findings).toEqual([
      { kind: "auto-install-candidate", id: "content-pack.demo", version: "0.1.0", detail: expect.any(String) },
    ]);
  });

  it("manual：同一个包 ⇒ human-review（报告照出，动作不动）", () => {
    const report = assess(inputs({ index: { bundles: { "content-pack.demo": entry() } } }), "manual", 1);
    expect(report.findings[0]!.kind).toBe("human-review");
  });

  it("反向：门没全绿 / 已激活 / 已清退 ⇒ 都不进待办", () => {
    const gatesPending = entry();
    gatesPending.versions["0.1.0"]!.gates = {};
    const active = entry({ active: { version: "0.1.0", activatedAt: "2026-10-25T00:00:00Z" } });
    const pruned = entry();
    pruned.versions["0.1.0"]!.prunedAt = "2026-10-25T00:00:00Z";
    const report = assess(
      inputs({ index: { bundles: { "content-pack.pending": gatesPending, "content-pack.live": active, "content-pack.gone": pruned } } }),
      "gated-auto",
      1,
    );
    expect(report.findings).toEqual([]);
  });

  it("复发连击 ≥ 阈值 ⇒ recurring-patch 进报告（喂 Planner 的那份料）", () => {
    const report = assess(inputs({ patchStats: { "cost-throttle": stats("cost-throttle", 3), "verify-escalate:code": stats("verify-escalate:code", 1) } }), "manual", 1);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0]).toMatchObject({ kind: "recurring-patch", key: "cost-throttle", streak: 3 });
  });

  it("高命中未毕业的 workflow ⇒ workflow-graduate；已注册的不重复报", () => {
    const report = assess(
      inputs({
        workflowHits: [{ topic: "workflow-a", hits: 5 }, { topic: "workflow-b", hits: 5 }],
        registeredWorkflowIds: new Set(["content-pack.workflow-b"]),
      }),
      "manual",
      1,
    );
    expect(report.findings).toEqual([{ kind: "workflow-graduate", topic: "workflow-a", hits: 5, detail: expect.any(String) }]);
  });

  it("canary 回退/降级档 ⇒ canary-lesson（同方向提案要先解释为何不同）", () => {
    const report = assess(
      inputs({ canaryFindings: [
        { id: "content-pack.bad", candidateVersion: "0.2.0", state: "rolled-back", degradationRules: ["consecutive-failures"] },
        { id: "content-pack.ok", candidateVersion: "0.1.0", state: "promoted", degradationRules: [] },
      ] }),
      "manual",
      1,
    );
    expect(report.findings.length).toBe(1);
    expect(report.findings[0]).toMatchObject({ kind: "canary-lesson", id: "content-pack.bad" });
  });
});

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sema-assess-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function stageReadyBundle(id: string, version: string): Promise<void> {
  const dir = join(root, "modules", "staging", id, version);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ id, version, kind: "content-pack", deps: [], permissions: [], gates: ["typecheck"] }), "utf8");
  await writeFile(join(dir, "prompt.md"), "# 打法\n正文\n", "utf8");
  const reg = new ModuleRegistry(root, { knownGates: new Set(GATES) });
  await reg.registerStaged(id, version, "test-pipeline");
  await reg.recordGate(id, version, "typecheck", true, "test-gate-runner");
}

describe("runAssess（真账本执行面）", () => {
  it("manual（缺省）：出报告 + human-review，但一个指头不动", async () => {
    await stageReadyBundle("content-pack.demo", "0.1.0");
    const res = await runAssess(root);
    expect(res).not.toBeNull();
    expect(res!.report.tier).toBe("manual");
    expect(res!.report.findings[0]!.kind).toBe("human-review");
    expect(res!.autoInstalled).toEqual([]);
    expect(existsSync(assessReportPathFor(root))).toBe(true);
    const reg = new ModuleRegistry(root, { knownGates: new Set(GATES) });
    expect((await reg.readIndex()).bundles["content-pack.demo"]!.active).toBeUndefined();
  });

  it("gated-auto：自动安装 + 开观察期；cost 基线 = 账本中位数；报告落 .agent/", async () => {
    await stageReadyBundle("content-pack.demo", "0.1.0");
    // 账本喂三条可测读数（9k / 10k / 50k ⇒ 中位 10k）。
    await appendLedger(root, [
      { v: 1, type: "run", ts: 1, verifyOutcome: "green", patches: 0, tokensPerBoundary: 9_000, costMeasurable: true },
      { v: 1, type: "run", ts: 2, verifyOutcome: "green", patches: 0, tokensPerBoundary: 10_000, costMeasurable: true },
      { v: 1, type: "run", ts: 3, verifyOutcome: "green", patches: 0, tokensPerBoundary: 50_000, costMeasurable: true },
    ]);
    await mkdir(join(root, "modules"), { recursive: true });
    await writeFile(join(root, "modules", "autonomy.json"), JSON.stringify({ tier: "gated-auto" }), "utf8");

    const res = await runAssess(root);
    expect(res!.autoInstalled).toEqual([{ id: "content-pack.demo", version: "0.1.0", outcome: "installed" }]);
    // 激活指针已切、观察档已开（baseline = 中位数 10k）。
    const reg = new ModuleRegistry(root, { knownGates: new Set(GATES) });
    expect((await reg.readIndex()).bundles["content-pack.demo"]!.active?.version).toBe("0.1.0");
    const record = JSON.parse(await readFile(join(root, ".agent", "canary", "content-pack.demo.json"), "utf8")) as {
      state: string; baselineTokensPerBoundary: number | null;
    };
    expect(record.state).toBe("observing");
    expect(record.baselineTokensPerBoundary).toBe(10_000);
    const report = JSON.parse(await readFile(assessReportPathFor(root), "utf8")) as { tier: string };
    expect(report.tier).toBe("gated-auto");
    // 第二轮 Assess：已激活 ⇒ 不再进待办，不重复安装。
    const again = await runAssess(root);
    expect(again!.autoInstalled).toEqual([]);
    expect(again!.report.findings).toEqual([]);
  });

  it("反向：modules/ 缺席 ⇒ 零行为（不建目录不出报告）", async () => {
    expect(await runAssess(root)).toBeNull();
    expect(existsSync(join(root, "modules"))).toBe(false);
    expect(existsSync(assessReportPathFor(root))).toBe(false);
  });

  it("反向：无 cost 读数 ⇒ 观察档不带编造的基线（cost 规则不判）", async () => {
    await stageReadyBundle("content-pack.fresh", "0.1.0");
    await mkdir(join(root, "modules"), { recursive: true });
    await writeFile(join(root, "modules", "autonomy.json"), JSON.stringify({ tier: "gated-auto" }), "utf8");
    const res = await runAssess(root);
    expect(res!.autoInstalled[0]!.outcome).toBe("installed");
    const record = JSON.parse(await readFile(join(root, ".agent", "canary", "content-pack.fresh.json"), "utf8")) as {
      baselineTokensPerBoundary: number | null;
    };
    expect(record.baselineTokensPerBoundary).toBeNull();
  });
});

describe("assess 与 autonomy 的接缝", () => {
  it("报告里的 tier 与资格裁决同源（autoInstallEligible 是单一出口）", async () => {
    // manual 与 gated-auto 的分类都出自 autoInstallEligible，报告只转述——两处读数必须一致。
    const manual = assess(inputs({ index: { bundles: { "content-pack.demo": entry() } } }), "manual", 1);
    const gated = assess(inputs({ index: { bundles: { "content-pack.demo": entry() } } }), "gated-auto", 1);
    const byEligibility = (tier: "manual" | "gated-auto"): string => (autoInstallEligible({ kind: "content-pack", permissions: [] }, tier).eligible ? "auto-install-candidate" : "human-review");
    expect(manual.findings[0]!.kind).toBe(byEligibility("manual"));
    expect(gated.findings[0]!.kind).toBe(byEligibility("gated-auto"));
  });
});
