// 首期接线判卷：候选档案 / 配对评价 / 运行面装载 / 收束 tick。全部在 tmp 工作区跑。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvolutionSignals } from "../src/agent/evolution/signal";
import { activeContentPackNote, tickCanaryFromSignals } from "../src/main/evolution/activation-host";
import {
  CandidateRecordError,
  digestFiles,
  parseCandidateRecord,
  readCandidateRecord,
  writeCandidateRecord,
  type CandidateRecord,
} from "../src/main/evolution/candidate-record";
import { evaluatePaired, type EvalRunOutput } from "../src/main/evolution/evaluator";
import { CanaryController, type CanarySample } from "../src/main/evolution/canary";
import { Installer } from "../src/main/evolution/installer";
import { ModuleRegistry } from "../src/main/evolution/registry";

const PACK_ID = "content-pack.prompt";
const GATES = new Set(["typecheck"]);

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "evo-kernel-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function baseRecord(over: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    schema: 1,
    id: PACK_ID,
    version: "1.2.0",
    parentVersion: "1.1.0",
    contentDigest: digestFiles({ "prompt.md": "hello\n" }),
    generator: { kind: "handwritten-demo", model: null, tools: [] },
    taskSet: { id: "tiny", version: "1", digest: "sha256:" + "0".repeat(64) },
    env: { commit: null, node: process.version, configDigest: null },
    runs: [],
    evaluation: { status: "pending", decision: "pending", reason: null },
    approvals: null,
    rollbackTo: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

async function stageAndInstall(
  id: string,
  version: string,
  files: Record<string, string>,
): Promise<ModuleRegistry> {
  const reg = new ModuleRegistry(root, { knownGates: GATES });
  const dir = join(root, "modules", "staging", id, version);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({ id, version, kind: id.split(".")[0], permissions: [], gates: ["typecheck"] }),
    "utf8",
  );
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text, "utf8");
  }
  await reg.registerStaged(id, version, "evo-pipeline");
  await reg.recordGate(id, version, "typecheck", true, "gate-runner");
  await new Installer(reg).installStaged({ id, version, actor: "human", grants: new Set() });
  return reg;
}

const red = (over: Partial<EvolutionSignals> = {}): EvolutionSignals => ({
  verifyFailuresByCause: { code: 1 },
  lastVerifyFailureCause: "code",
  repeatedVerifyCause: null,
  verifyOutcome: "red",
  goalDriftCount: 0,
  goalDriftMeasurable: false,
  costMeasurable: false,
  tokensPerBoundary: null,
  spendAfterLastBoundary: 0,
  eventCount: 3,
  ...over,
});

const canarySample = (over: Partial<CanarySample> = {}): CanarySample => ({
  runId: "run-1",
  verifyOutcome: "green",
  costMeasurable: false,
  tokensPerBoundary: null,
  spendAfterLastBoundary: 0,
  ...over,
});

describe("候选档案：完整性以摘要绑定，不以 signedBy 取信", () => {
  it("摘要与文件插入顺序无关，内容变化即变", () => {
    const a = digestFiles({ "b.md": "B", "a.md": "A" });
    const b = digestFiles({ "a.md": "A", "b.md": "B" });
    expect(a).toBe(b);
    expect(digestFiles({ "a.md": "A", "b.md": "B!" })).not.toBe(a);
  });

  it("写入/读回保留父版本、生成器配置、任务集与实际成本", async () => {
    const record = baseRecord({
      runs: [{
        runId: "r1", taskId: "t1", split: "search", ok: true, costUsd: 0.25,
        tokens: 12, durationMs: 34, artifactDigest: "sha256:" + "1".repeat(64), failureReason: null,
      }],
      evaluation: { status: "passed", decision: "promote", reason: "cheaper" },
      approvals: { approvedBy: "owner-human", at: new Date().toISOString() },
    });
    const path = await writeCandidateRecord(root, record);
    expect(path).toContain(join("modules", "candidates", PACK_ID, "1.2.0.json"));
    const back = await readCandidateRecord(root, PACK_ID, "1.2.0");
    expect(back).toEqual(record);
  });

  it("缺文件 = null；坏档案/未知字段 fail-closed", async () => {
    expect(await readCandidateRecord(root, PACK_ID, "1.2.0")).toBeNull();
    expect(() => parseCandidateRecord({ ...baseRecord(), extra: true })).toThrow(CandidateRecordError);
    const dir = join(root, "modules", "candidates", PACK_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "1.2.0.json"), "{not json", "utf8");
    await expect(readCandidateRecord(root, PACK_ID, "1.2.0")).rejects.toThrow();
  });
});

describe("配对评价：先正确性，再成本/耗时；缺证据不晋升", () => {
  const tasks = [
    { id: "s1", split: "search" as const },
    { id: "v1", split: "validation" as const },
  ];

  const outcomes = (map: Record<string, EvalRunOutput>) => async ({ version, task }: { version: string; task: { id: string } }) => {
    const key = version + ":" + task.id;
    const found = map[key];
    if (found === undefined) throw new Error("missing outcome " + key);
    return found;
  };

  const ok = (costUsd: number, durationMs = 100): EvalRunOutput => ({
    ok: true, costUsd, tokens: 10, durationMs, artifactDigest: "sha256:" + "2".repeat(64), failureReason: null,
  });

  it("正确性不劣且成本下降 ≥ 阈值 ⇒ promote", async () => {
    const result = await evaluatePaired({
      baselineVersion: "1.1.0",
      candidateVersion: "1.2.0",
      tasks,
      run: outcomes({
        "1.1.0:s1": ok(1), "1.1.0:v1": ok(1),
        "1.2.0:s1": ok(0.5), "1.2.0:v1": ok(0.5),
      }),
    });
    expect(result.status).toBe("passed");
    expect(result.decision).toBe("promote");
  });

  it("差异不足 ⇒ keep-old", async () => {
    const result = await evaluatePaired({
      baselineVersion: "1.1.0",
      candidateVersion: "1.2.0",
      tasks,
      run: outcomes({
        "1.1.0:s1": ok(1), "1.1.0:v1": ok(1),
        "1.2.0:s1": ok(1), "1.2.0:v1": ok(1),
      }),
    });
    expect(result.status).toBe("passed");
    expect(result.decision).toBe("keep-old");
  });

  it("候选在任何任务（含 holdout）上不正确 ⇒ failed", async () => {
    const result = await evaluatePaired({
      baselineVersion: "1.1.0",
      candidateVersion: "1.2.0",
      tasks,
      run: outcomes({
        "1.1.0:s1": ok(1), "1.1.0:v1": ok(1),
        "1.2.0:s1": ok(0.1), "1.2.0:v1": { ...ok(0.1), ok: false },
      }),
    });
    expect(result.status).toBe("failed");
    expect(result.decision).toBe("keep-old");
  });

  it("缺证据（ok=null）⇒ unmeasurable + keep-old", async () => {
    const result = await evaluatePaired({
      baselineVersion: "1.1.0",
      candidateVersion: "1.2.0",
      tasks,
      run: outcomes({
        "1.1.0:s1": ok(1), "1.1.0:v1": ok(1),
        "1.2.0:s1": { ...ok(0.1), ok: null }, "1.2.0:v1": ok(0.1),
      }),
    });
    expect(result.status).toBe("unmeasurable");
    expect(result.decision).toBe("keep-old");
  });

  it("没有 holdout 验证任务 ⇒ 正确性通过也不晋升", async () => {
    const result = await evaluatePaired({
      baselineVersion: "1.1.0",
      candidateVersion: "1.2.0",
      tasks: [{ id: "s1", split: "search" }],
      run: outcomes({ "1.1.0:s1": ok(1), "1.2.0:s1": ok(0.1) }),
    });
    expect(result.status).toBe("passed");
    expect(result.decision).toBe("keep-old");
    expect(result.reason).toContain("holdout");
  });

  it("修好基线未通过的任务 ⇒ 正确性优先，可晋升", async () => {
    const result = await evaluatePaired({
      baselineVersion: "1.1.0",
      candidateVersion: "1.2.0",
      tasks,
      run: outcomes({
        "1.1.0:s1": { ...ok(1), ok: false }, "1.1.0:v1": ok(1),
        "1.2.0:s1": ok(1), "1.2.0:v1": ok(1),
      }),
    });
    expect(result.status).toBe("passed");
    expect(result.decision).toBe("promote");
  });
});

describe("运行面装载与收束 tick", () => {
  const packFiles = {
    "prompt.md": "Always cite sources.\n",
    "system.md": "Be terse.\n",
    "notes.txt": "not a prompt\n",
  };

  async function installWithRecord(version = "1.0.0"): Promise<void> {
    await stageAndInstall(PACK_ID, version, packFiles);
    await writeCandidateRecord(root, baseRecord({
      version,
      parentVersion: null,
      contentDigest: digestFiles(packFiles),
    }));
  }

  it("active content-pack 的 prompt.md/system.md 进提示词；其它文件不进", async () => {
    await installWithRecord();
    const note = await activeContentPackNote(root);
    expect(note).toContain(PACK_ID + "@1.0.0");
    expect(note).toContain("Always cite sources.");
    expect(note).toContain("Be terse.");
    expect(note).not.toContain("not a prompt");
  });

  // 索引是投影：缺了/坏了都从日志重建（registry.ts loadOrRebuild）。生产读面不带门名单
  // （src 侧不抄第二份，activation-host.ts:7-8）⇒ rebuildInner 重放时门那一格只能认
  // **账本自己定格的 declaredGates**（这些门注册时已对照真名单校验过）。修前：重建拿空
  // knownGates 去卡它们 ⇒ 一份完全合法的账本被判死（RegistryLogCorruptError）⇒ 注入与
  // 收束 tick 一起熄火，而且每次重建都撞同一行 ⇒ **自愈不了**。
  it("索引丢了要重建 ⇒ 重建不许因为门名单把账本判死（注入结果与索引新鲜时逐字节一致）", async () => {
    await installWithRecord();
    const fresh = await activeContentPackNote(root);
    expect(fresh).toContain("Always cite sources.");
    // 模拟「日志已 append、索引落盘前进程被杀」⇒ 下次读必须重建
    await rm(join(root, "modules", "registry.index.json"), { force: true });
    expect(await activeContentPackNote(root)).toBe(fresh);
  });

  it("安装后盘上内容被改（摘要不符）⇒ 拒绝注入", async () => {
    await installWithRecord();
    await writeFile(join(root, "modules", "installed", PACK_ID, "1.0.0", "prompt.md"), "TAMPERED\n", "utf8");
    expect(await activeContentPackNote(root)).toBe("");
  });

  it("没有候选档案 ⇒ 拒绝注入（无法核验摘要）", async () => {
    await stageAndInstall(PACK_ID, "1.0.0", packFiles);
    expect(await activeContentPackNote(root)).toBe("");
  });

  it("没有 modules/ ⇒ 空串（系统提示词逐字节不变）", async () => {
    expect(await activeContentPackNote(root)).toBe("");
  });

  it("none 样本只进审计，不计入晋升门槛", async () => {
    const reg = await stageAndInstall(PACK_ID, "1.0.0", { "prompt.md": "x\n" });
    const ctl = new CanaryController({ registry: reg, workspace: root });
    const start = await ctl.begin({ id: PACK_ID, maxSamples: 2, maxConsecutiveFailures: 99 });
    expect(start.conclusiveSamples).toBe(0);
    const a = await ctl.observe(PACK_ID, canarySample({ verifyOutcome: "none" }));
    const b = await ctl.observe(PACK_ID, canarySample({ verifyOutcome: "none" }));
    expect(a.observation).toMatchObject({ state: "observing", samples: 1, conclusiveSamples: 0 });
    expect(b.observation).toMatchObject({ state: "observing", samples: 2, conclusiveSamples: 0 });
    expect(b.acted).toBe(false);
    const c = await ctl.observe(PACK_ID, canarySample({ verifyOutcome: "green" }));
    expect(c.observation).toMatchObject({ state: "observing", samples: 3, conclusiveSamples: 1 });
    const d = await ctl.observe(PACK_ID, canarySample({ verifyOutcome: "green" }));
    expect(d.observation).toMatchObject({ state: "promoted", samples: 4, conclusiveSamples: 2 });
    expect(d.acted).toBe(true);
  });

  it("收束 tick 用本轮读数续档；没有观察档 ⇒ 零行为", async () => {
    await stageAndInstall(PACK_ID, "1.0.0", { "prompt.md": "x\n" });
    expect(await tickCanaryFromSignals(root, red(), "run-1")).toEqual([]);

    const dir = join(root, ".agent", "canary");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, PACK_ID + ".json"),
      JSON.stringify({
        version: 1,
        id: PACK_ID,
        candidateVersion: "1.0.0",
        previousVersion: null,
        state: "observing",
        samples: 0,
        consecutiveFailures: 0,
        baselineTokensPerBoundary: null,
        maxSamples: 10,
        maxConsecutiveFailures: 5,
        costDegradeFactor: 2,
        degradations: [],
        startedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    const ticks = await tickCanaryFromSignals(root, red(), "run-2");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.observation).toMatchObject({
      samples: 1,
      consecutiveFailures: 1,
      conclusiveSamples: 1,
      state: "observing",
    });
    expect(ticks[0]!.acted).toBe(false);
  });

  // 收束缝走的是同一条读账本的路（activation-host.ts:138 openEvolutionRegistry）。
  // 索引丢了 ⇒ 重建 ⇒ 这一缝也必须续上档；修前它在重建那一步就炸（RegistryLogCorruptError），
  // 由 post-run-readings.ts:85 吞成一行告警 ⇒ **观察期永远收不了束**（退化版本一直装着）。
  it("索引丢了要重建 ⇒ 收束 tick 仍能续档（不是被重建那一步炸掉）", async () => {
    await stageAndInstall(PACK_ID, "1.0.0", { "prompt.md": "x\n" });
    const dir = join(root, ".agent", "canary");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, PACK_ID + ".json"),
      JSON.stringify({
        version: 1,
        id: PACK_ID,
        candidateVersion: "1.0.0",
        previousVersion: null,
        state: "observing",
        samples: 0,
        consecutiveFailures: 0,
        baselineTokensPerBoundary: null,
        maxSamples: 10,
        maxConsecutiveFailures: 5,
        costDegradeFactor: 2,
        degradations: [],
        startedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    await rm(join(root, "modules", "registry.index.json"), { force: true });
    const ticks = await tickCanaryFromSignals(root, red(), "run-3");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.observation).toMatchObject({ samples: 1, conclusiveSamples: 1, state: "observing" });
  });
});
