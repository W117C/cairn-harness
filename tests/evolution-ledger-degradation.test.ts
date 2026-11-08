// 判卷：坏账本不许把两条生产缝一起带走。
//
// 缺陷形状（PROGRESS 第 642 页 §5 登记的 P1）：账本投影要重建时，重放撞上坏行 ⇒
// RegistryLogCorruptError 从**共用**的开口（activation-host.openEvolutionRegistry）抛出去
// ⇒ content-pack 注入与 canary 收束 tick 两条链同时熄火。收束缝熄火 = 观察期收不到样本
// = 连败计数不再前进 = 退化版本永远装着退不下来（安全网灭掉比少一段提示词严重得多）。
//
// 判卷断言的是**运行期行为**（真的起一个工作区、真的把账本写坏、真的跑那两条链），
// 不是源码里有没有某行字：
//   ① 坏账本下**收束链照旧推进**（观察档 samples / consecutiveFailures 前进）——它没被带走；
//   ② 坏账本下**注入链只降级不抛**（返回空串），且出声说清是「账本读不动」而不是「没有包」；
//   ③ 两条链各自的降级**都留可见痕迹**（各一条出声，且各带自己那侧的标签）；
//   ④ 好账本下两条链都照旧（不许为了修坏档把正常面也改了）；
//   ⑤ 没有账本的工作区仍是零行为且**不出声**（零行为与「坏档」是两个数）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvolutionSignals } from "../src/agent/evolution/signal";
import { activeContentPackNote, tickCanaryFromSignals } from "../src/main/evolution/activation-host";
import { digestFiles, writeCandidateRecord } from "../src/main/evolution/candidate-record";
import { Installer } from "../src/main/evolution/installer";
import { ModuleRegistry } from "../src/main/evolution/registry";

const PACK_ID = "content-pack.prompt";
const GATES = new Set(["typecheck"]);
const PACK_FILES = { "prompt.md": "Always cite sources.\n", "system.md": "Be terse.\n" };

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "evo-ledger-degrade-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 起一个完整工作区：一个已激活的 content-pack + 一份候选档案 + 一档开着的观察期。 */
async function seedWorkspace(): Promise<void> {
  const reg = new ModuleRegistry(root, { knownGates: GATES });
  const dir = join(root, "modules", "staging", PACK_ID, "1.0.0");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({ id: PACK_ID, version: "1.0.0", kind: "content-pack", permissions: [], gates: ["typecheck"] }),
    "utf8",
  );
  for (const [rel, text] of Object.entries(PACK_FILES)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text, "utf8");
  }
  await reg.registerStaged(PACK_ID, "1.0.0", "evo-pipeline");
  await reg.recordGate(PACK_ID, "1.0.0", "typecheck", true, "gate-runner");
  await new Installer(reg).installStaged({ id: PACK_ID, version: "1.0.0", actor: "human", grants: new Set() });
  await writeCandidateRecord(root, {
    schema: 1,
    id: PACK_ID,
    version: "1.0.0",
    parentVersion: null,
    contentDigest: digestFiles(PACK_FILES),
    generator: { kind: "handwritten-demo", model: null, tools: [] },
    taskSet: { id: "tiny", version: "1", digest: "sha256:" + "0".repeat(64) },
    env: { commit: null, node: process.version, configDigest: null },
    runs: [],
    evaluation: { status: "pending", decision: "pending", reason: null },
    approvals: null,
    rollbackTo: null,
    createdAt: new Date().toISOString(),
  });
  const canaryDir = join(root, ".agent", "canary");
  await mkdir(canaryDir, { recursive: true });
  await writeFile(
    join(canaryDir, PACK_ID + ".json"),
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
}

/** 坏档：账本**中段**插一条坏行（尾部半写行账本自己会修，不是这一格要钉的形状），
 *  并删掉投影 ⇒ 读账本必须重放 ⇒ 重放撞坏行 ⇒ RegistryLogCorruptError。 */
async function corruptLedger(): Promise<void> {
  const logPath = join(root, "modules", "registry.jsonl");
  const lines = (await readFile(logPath, "utf8")).split("\n");
  lines.splice(Math.max(1, Math.floor(lines.length / 2)), 0, "{ this is not a ledger line");
  await writeFile(logPath, lines.join("\n"), "utf8");
  await rm(join(root, "modules", "registry.index.json"), { force: true });
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

/** 收出声（手动换 console.warn + finally 还原：本仓既有写法，不用 mock 框架）。 */
function captureWarns(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const prev = console.warn;
  console.warn = (...a: unknown[]): void => {
    lines.push(a.map((x) => String(x)).join(" "));
  };
  return { lines, restore: (): void => { console.warn = prev; } };
}

const recordOnDisk = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(root, ".agent", "canary", PACK_ID + ".json"), "utf8")) as Record<string, unknown>;

describe("坏账本：一条链降级不许把另一条链一起带走", () => {
  it("收束链照旧推进观察期（连败计数不许被清零），注入链只降级不抛，且两边都出声", async () => {
    await seedWorkspace();
    await corruptLedger();
    const warns = captureWarns();
    let note = "";
    let ticks: Awaited<ReturnType<typeof tickCanaryFromSignals>> = [];
    let thrown: unknown = null;
    try {
      note = await activeContentPackNote(root);
      ticks = await tickCanaryFromSignals(root, red(), "run-bad");
    } catch (err) {
      thrown = err;
    } finally {
      warns.restore();
    }

    // 共用开口不再抛 ⇒ 一把带走两条链这件事本身没了。
    expect(thrown).toBe(null);

    // ① 收束链：观察档照旧收样本（samples 0→1、consecutiveFailures 0→1，档仍开着）。
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.outcome).toBe("resumed");
    expect(ticks[0]!.observation).toMatchObject({ samples: 1, consecutiveFailures: 1, state: "observing" });
    expect(await recordOnDisk()).toMatchObject({ samples: 1, consecutiveFailures: 1, state: "observing" });

    // ② 注入链：降级（不注入）但**不抛**；出声说清是「账本读不动」，不是「没有包」。
    expect(note).toBe("");
    const packWarn = warns.lines.find((line) => line.includes("[evolution-pack]"));
    expect(packWarn).toBeTruthy();
    expect(packWarn).toContain("账本读不动");
    expect(packWarn).toContain("不是没有包");

    // ③ 收束链的降级也留可见痕迹（两条链各带各的标签，不共用一条）。
    const canaryWarn = warns.lines.find((line) => line.includes("[canary]"));
    expect(canaryWarn).toBeTruthy();
    expect(canaryWarn).toContain("账本读不动");
  });

  it("好账本下两条链都照旧（不许为了修坏档把正常面也改了）", async () => {
    await seedWorkspace();
    const note = await activeContentPackNote(root);
    expect(note).toContain("Always cite sources.");
    const ticks = await tickCanaryFromSignals(root, red(), "run-good");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.outcome).toBe("resumed");
    expect(ticks[0]!.observation).toMatchObject({ samples: 1, consecutiveFailures: 1, state: "observing" });
  });

  it("没有账本的工作区仍是零行为且不出声（零行为与坏档是两个数）", async () => {
    const warns = captureWarns();
    let note: string | null = null;
    let ticks: Awaited<ReturnType<typeof tickCanaryFromSignals>> | null = null;
    try {
      note = await activeContentPackNote(root);
      ticks = await tickCanaryFromSignals(root, red(), "run-none");
    } finally {
      warns.restore();
    }
    expect(note).toBe("");
    expect(ticks).toEqual([]);
    expect(warns.lines).toEqual([]);
  });
});
