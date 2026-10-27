// SEMA Phase 4 判卷（docs/sema-proposal.md §7 Phase 4 / §8 退化验证口径）：
// 运行面装载器（已激活包重验 + 三 kind 装载）与 canary 观察期（退化自动回退 + lesson 沉淀）。
// 判据全在 tmp 根上跑（测试数据绝不落工作区）；门执行面与 lesson 写盘都用注桩/临时目录，不起真进程。
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATES } from "../scripts/gate-manifest";
import {
  CanaryController,
  CanaryRefusedError,
  canaryLessonTopic,
  checkStagingLedgerConsistency,
  RuntimeLoader,
  type CanarySample,
} from "../src/main/evolution/canary";
import { Installer } from "../src/main/evolution/installer";
import { ModuleRegistry } from "../src/main/evolution/registry";

const GATE_SET = new Set(GATES);

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sema-canary-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function registry(): ModuleRegistry {
  return new ModuleRegistry(root, { knownGates: GATE_SET });
}

async function stageBundle(
  id: string,
  version: string,
  over: Record<string, unknown> = {},
  files: Record<string, string> = { "index.ts": "export const v = 1;\n" },
): Promise<void> {
  const dir = join(root, "modules", "staging", id, version);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({ id, version, kind: id.split(".")[0], entry: "index.ts", deps: [], permissions: [], gates: ["typecheck"], ...over }),
    "utf8",
  );
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text, "utf8");
  }
}

async function installBundle(reg: ModuleRegistry, id: string, version: string): Promise<void> {
  await reg.registerStaged(id, version, "evo-pipeline");
  await reg.recordGate(id, version, "typecheck", true, "gate-runner");
  await new Installer(reg).installStaged({ id, version, actor: "human", grants: new Set() });
}

const greenSample = (over: Partial<CanarySample> = {}): CanarySample => ({
  runId: "run-1",
  verifyOutcome: "green",
  costMeasurable: true,
  tokensPerBoundary: 9_000,
  spendAfterLastBoundary: 0,
  ...over,
});

describe("运行面装载（RuntimeLoader：只装已激活版本，逐层重验）", () => {
  it("装载已激活 tool：entry 文本读到，deps 带出", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0", { deps: ["src/tools/base"] }, { "index.ts": "export const demo = 1;\n" });
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    const loaded = await new RuntimeLoader(reg).load("tool.demo-fetch");
    expect(loaded.kind).toBe("tool");
    if (loaded.kind !== "tool") return;
    expect(loaded.version).toBe("0.1.0");
    expect(loaded.source).toContain("export const demo = 1");
    expect(loaded.deps).toEqual(["src/tools/base"]);
  });

  it("反向：未激活版本与账外的 id 都拒绝装载", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await installBundle(reg, "tool.demo-fetch", "0.2.0");
    await expect(new RuntimeLoader(reg).load("tool.demo-fetch", "0.1.0")).rejects.toThrow(/不是当前激活版本/);
    await expect(new RuntimeLoader(reg).load("tool.nope")).rejects.toThrow(/不在账本上/);
  });

  it("反向：安装后被改过 manifest（entry 漂移）或 entry 文件没了 ⇒ 拒绝装载", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    const dir = join(root, "modules", "installed", "tool.demo-fetch", "0.1.0");
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ ...manifest, entry: "other.ts" }), "utf8");
    await expect(new RuntimeLoader(reg).load("tool.demo-fetch")).rejects.toThrow(/与注册定格不一致/);
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
    await rm(join(dir, "index.ts"));
    await expect(new RuntimeLoader(reg).load("tool.demo-fetch")).rejects.toThrow(/拒绝装载/);
  });

  it("content-pack：除 manifest.json 外的文本全收（含子目录），按路径排序", async () => {
    const reg = registry();
    await stageBundle("content-pack.demo-prompts", "0.1.0", { entry: undefined }, { "a.txt": "A\n", "sub/b.txt": "B\n" });
    await installBundle(reg, "content-pack.demo-prompts", "0.1.0");
    const loaded = await new RuntimeLoader(reg).load("content-pack.demo-prompts");
    expect(loaded.kind).toBe("content-pack");
    if (loaded.kind !== "content-pack") return;
    expect(loaded.files.map((f) => f.rel)).toEqual(["a.txt", "sub/b.txt"]);
    expect(loaded.files[1]!.text).toContain("B");
  });

  it("desktop-panel：进得了装载面（kind 与 deps 带出）", async () => {
    const reg = registry();
    await stageBundle("desktop-panel.usage-chart", "0.1.0", { deps: ["apps/desktop/src/panels"] });
    await installBundle(reg, "desktop-panel.usage-chart", "0.1.0");
    const loaded = await new RuntimeLoader(reg).load("desktop-panel.usage-chart");
    expect(loaded).toMatchObject({ kind: "desktop-panel", version: "0.1.0", deps: ["apps/desktop/src/panels"] });
  });

  it("反向：service 这类不进运行面的 kind 直接拒绝", async () => {
    const reg = registry();
    await stageBundle("service.api", "0.1.0");
    await installBundle(reg, "service.api", "0.1.0");
    await expect(new RuntimeLoader(reg).load("service.api")).rejects.toThrow(/不进运行面/);
  });

  it("装载帽：越帽的 entry 拒绝", async () => {
    const reg = registry();
    await stageBundle("tool.big", "0.1.0", {}, { "index.ts": "x".repeat(500) });
    await installBundle(reg, "tool.big", "0.1.0");
    await expect(new RuntimeLoader(reg, { maxFileBytes: 100 }).load("tool.big")).rejects.toThrow(/越过装载帽/);
  });

  it("装载帽：content-pack 的文件数与总量两帽都拦得住", async () => {
    const reg = registry();
    await stageBundle("content-pack.demo-prompts", "0.1.0", { entry: undefined }, { "a.txt": "A\n", "sub/b.txt": "B\n" });
    await installBundle(reg, "content-pack.demo-prompts", "0.1.0");
    await expect(new RuntimeLoader(reg, { maxFiles: 1 }).load("content-pack.demo-prompts")).rejects.toThrow(/文件数越过装载帽/);
    await expect(new RuntimeLoader(reg, { maxTotalBytes: 1 }).load("content-pack.demo-prompts")).rejects.toThrow(
      /文本体量越过装载帽/,
    );
  });
});

describe("canary 观察期（退化自动回退 + lesson 沉淀）", () => {
  it("观察期满无退化 ⇒ promoted（active 不动）", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await installBundle(reg, "tool.demo-fetch", "0.2.0");
    const ctl = new CanaryController({ registry: reg, workspace: root });
    const start = await ctl.begin({ id: "tool.demo-fetch", maxSamples: 3, baselineTokensPerBoundary: 10_000 });
    expect(start.state).toBe("observing");
    expect(start.previousVersion).toBe("0.1.0");
    expect((await ctl.observe("tool.demo-fetch", greenSample())).acted).toBe(false);
    expect((await ctl.observe("tool.demo-fetch", greenSample())).acted).toBe(false);
    const last = await ctl.observe("tool.demo-fetch", greenSample());
    expect(last.acted).toBe(true);
    expect(last.observation.state).toBe("promoted");
    expect((await reg.readIndex()).bundles["tool.demo-fetch"]?.active?.version).toBe("0.2.0");
  });

  it("连续失败 ×2 ⇒ 自动回退 previous，并落 lesson（带 evidence-line 与读数）", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await installBundle(reg, "tool.demo-fetch", "0.2.0");
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch", maxConsecutiveFailures: 2 });
    const red = greenSample({ runId: "run-9", verifyOutcome: "red", tokensPerBoundary: 1_000 });
    expect((await ctl.observe("tool.demo-fetch", red)).observation.state).toBe("observing");
    const res = await ctl.observe("tool.demo-fetch", red);
    expect(res.acted).toBe(true);
    expect(res.observation.state).toBe("rolled-back");
    expect(res.observation.rollbackTo).toBe("0.1.0");
    expect(res.observation.lessonWritten).toBe(true);
    const idx = await reg.readIndex();
    expect(idx.bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
    expect(idx.bundles["tool.demo-fetch"]?.previous?.version).toBe("0.2.0");
    const lesson = await readFile(
      join(root, ".agent", "memory", canaryLessonTopic("tool.demo-fetch", "0.2.0") + ".md"),
      "utf8",
    );
    expect(lesson).toContain("evidence-line:");
    expect(lesson).toContain("观察期退化");
    expect(lesson).toContain("已回退到 0.1.0");
    expect(lesson).toContain("连续 2 个样本 verify 未转绿");
  });

  it("成本不可测 ⇒ 不判 no-progress（不可测 ≠ 无前进）；可测且便宜也不判", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await installBundle(reg, "tool.demo-fetch", "0.2.0");
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch" });
    const dead = await ctl.observe(
      "tool.demo-fetch",
      greenSample({ verifyOutcome: "none", costMeasurable: false, tokensPerBoundary: null, spendAfterLastBoundary: 5_000 }),
    );
    // 2026-10-19：measurable=false 的常见成因是「本跑没有模型 verify 调用」，不是退化。
    expect(dead.observation.state).toBe("observing");
    expect(dead.observation.degradations).toEqual([]);
    // 可测且便宜 ⇒ 同样一条都不判（规则不是"总是回退"）。
    const fine = await ctl.observe("tool.demo-fetch", greenSample({ tokensPerBoundary: 1_000 }));
    expect(fine.observation.state).toBe("observing");
    expect(fine.observation.degradations).toEqual([]);
  });

  it("cost-per-progress：越过基线 ×2 ⇒ 回退并点名倍数", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await installBundle(reg, "tool.demo-fetch", "0.2.0");
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch", baselineTokensPerBoundary: 10_000, costDegradeFactor: 2 });
    const res = await ctl.observe("tool.demo-fetch", greenSample({ tokensPerBoundary: 25_000 }));
    expect(res.observation.state).toBe("rolled-back");
    expect(res.observation.degradations.map((x) => x.rule)).toEqual(["cost-per-progress"]);
    // 读数细节在 lesson 里逐字可对（断言读的是文件正文，不锚在字段上）。
    const lesson = await readFile(
      join(root, ".agent", "memory", canaryLessonTopic("tool.demo-fetch", "0.2.0") + ".md"),
      "utf8",
    );
    expect(lesson).toContain("是基线 10000 的 2.5 倍");
  });

  it("没有基线 ⇒ 贵也不判（不编造基线），观察期满 promoted", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await installBundle(reg, "tool.demo-fetch", "0.2.0");
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch", maxSamples: 1 });
    const res = await ctl.observe("tool.demo-fetch", greenSample({ tokensPerBoundary: 1_000_000 }));
    expect(res.observation.state).toBe("promoted");
    expect(res.observation.degradations).toEqual([]);
  });

  it("没有 previous 可回退 ⇒ degraded + 原因留档，lesson 照写", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch", maxConsecutiveFailures: 1 });
    const res = await ctl.observe("tool.demo-fetch", greenSample({ verifyOutcome: "red" }));
    expect(res.observation.state).toBe("degraded");
    expect(res.observation.rollbackError).toContain("没有 previous 版本可回退");
    expect(res.observation.lessonWritten).toBe(true);
    expect((await reg.readIndex()).bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
  });

  it("begin 先装载一次：entry 被删 ⇒ 拒绝进观察期", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await rm(join(root, "modules", "installed", "tool.demo-fetch", "0.1.0", "index.ts"));
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await expect(ctl.begin({ id: "tool.demo-fetch" })).rejects.toThrow(/拒绝装载/);
    expect(ctl.status("tool.demo-fetch")).toBeUndefined();
  });

  it("lesson 写盘失败 ⇒ 回滚照做，只记 lessonWritten=false / lessonError", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await installBundle(reg, "tool.demo-fetch", "0.2.0");
    const ctl = new CanaryController({
      registry: reg,
      workspace: root,
      writeLesson: async () => {
        throw new Error("disk full");
      },
    });
    await ctl.begin({ id: "tool.demo-fetch", maxConsecutiveFailures: 1 });
    const res = await ctl.observe("tool.demo-fetch", greenSample({ verifyOutcome: "red" }));
    expect(res.observation.state).toBe("rolled-back");
    expect(res.observation.lessonWritten).toBe(false);
    expect(res.observation.lessonError).toContain("disk full");
    expect((await reg.readIndex()).bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
    expect(existsSync(join(root, ".agent", "memory", canaryLessonTopic("tool.demo-fetch", "0.2.0") + ".md"))).toBe(false);
  });
});

describe("观察档跨进程续档（账本校验 + 续档，不靠时间戳推断候选）", () => {
  const recordPath = (id: string): string => join(root, ".agent", "canary", id + ".json");

  async function twoVersions(): Promise<ModuleRegistry> {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    await stageBundle("tool.demo-fetch", "0.2.0");
    await installBundle(reg, "tool.demo-fetch", "0.2.0");
    return reg;
  }

  it("进程 A 开档收一红；进程 B 只靠盘上的档接着数，第二个红即回滚", async () => {
    await twoVersions();
    const red = greenSample({ verifyOutcome: "red", tokensPerBoundary: 1_000 });
    const ctlA = new CanaryController({ registry: registry(), workspace: root });
    await ctlA.begin({ id: "tool.demo-fetch" }); // 开档由装上位的宿主拍板，账本只做校验
    const first = await ctlA.tickAll(red);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: "tool.demo-fetch", outcome: "resumed", acted: false });
    expect(first[0]!.observation?.samples).toBe(1);
    expect(existsSync(recordPath("tool.demo-fetch"))).toBe(true);

    // 进程 B：新 registry、新控制器（内存空白），读数从盘上的档接回来。
    const regB = registry();
    const ctlB = new CanaryController({ registry: regB, workspace: root });
    const second = await ctlB.tickAll(red);
    expect(second[0]).toMatchObject({ id: "tool.demo-fetch", outcome: "resumed", acted: true });
    expect(second[0]!.observation?.state).toBe("rolled-back");
    expect(second[0]!.observation?.samples).toBe(2);
    expect((await regB.readIndex()).bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
  });

  it("观察档版本不认 ⇒ 点名 refused（读不动不许折成没有档）", async () => {
    await twoVersions();
    const p = recordPath("tool.demo-fetch");
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ version: 99 }), "utf8");
    const ctl = new CanaryController({ registry: registry(), workspace: root });
    const r = await ctl.tickAll(greenSample());
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "tool.demo-fetch", outcome: "refused" });
    expect(r[0]!.refused).toContain("观察档版本不认");
  });

  it("反向：盘上没有档 ⇒ tickAll 一条都不动（不替谁开档）", async () => {
    await twoVersions();
    const reg = registry();
    const ctl = new CanaryController({ registry: reg, workspace: root });
    expect(await ctl.tickAll(greenSample())).toEqual([]);
    expect(await ctl.openObservations()).toEqual([]);
    expect(existsSync(join(root, ".agent", "canary"))).toBe(false);
  });

  it("反向：账本已经换过人（回滚过）⇒ 档退场，不再喂样本，active 不动", async () => {
    const reg = await twoVersions();
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch" }); // 档的候选是 0.2.0
    await new Installer(reg).rollbackInstalled("tool.demo-fetch", "canary-undo");
    const restarted = new CanaryController({ registry: reg, workspace: root });
    const tick = await restarted.tickAll(greenSample({ verifyOutcome: "red" }));
    expect(tick[0]).toMatchObject({ id: "tool.demo-fetch", outcome: "idle" });
    expect(tick[0]!.observation?.candidateVersion).toBe("0.2.0");
    expect(tick[0]!.observation?.samples).toBe(0);
    expect(await restarted.openObservations()).toEqual([]);
    expect((await reg.readIndex()).bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
  });

  it("反向：档读了坏 JSON ⇒ refused，既不喂样本也不覆盖（连败计数不许静默清零）", async () => {
    const reg = await twoVersions();
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch" });
    await writeFile(recordPath("tool.demo-fetch"), "{ 这不是 JSON", "utf8");
    const fresh = new CanaryController({ registry: reg, workspace: root });
    const tick = await fresh.tickAll(greenSample({ verifyOutcome: "red" }));
    expect(tick).toHaveLength(1);
    expect(tick[0]).toMatchObject({ id: "tool.demo-fetch", outcome: "refused", observation: null, acted: false });
    expect(await readFile(recordPath("tool.demo-fetch"), "utf8")).toBe("{ 这不是 JSON");
    // 坏档也不许被重开顶掉：begin 同一条口径。
    await expect(fresh.begin({ id: "tool.demo-fetch" })).rejects.toThrow(/读不出来/);
  });

  it("反向：结案的档（promoted）不再被续档喂样本", async () => {
    const reg = await twoVersions();
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch", maxSamples: 1 });
    await ctl.observe("tool.demo-fetch", greenSample());
    const restarted = new CanaryController({ registry: reg, workspace: root });
    const tick = await restarted.tickAll(greenSample());
    expect(tick[0]).toMatchObject({ id: "tool.demo-fetch", outcome: "settled" });
    expect(tick[0]!.observation?.samples).toBe(1);
    expect(await restarted.openObservations()).toEqual([]);
  });

  it("正向：重开同一候选的档被拒（续档走 tickAll），结案后再开可以", async () => {
    const reg = await twoVersions();
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.demo-fetch" });
    const another = new CanaryController({ registry: reg, workspace: root });
    await expect(another.begin({ id: "tool.demo-fetch" })).rejects.toThrow(/没结案的观察记录/);
    await ctl.observe("tool.demo-fetch", greenSample({ verifyOutcome: "red" }));
    await ctl.observe("tool.demo-fetch", greenSample({ verifyOutcome: "red" })); // 结案：rolled-back
    const third = new CanaryController({ registry: reg, workspace: root });
    expect((await third.begin({ id: "tool.demo-fetch" })).state).toBe("observing");
  });

  it("反向：观察档写不下 ⇒ begin 拒绝（看不见的观察期不算观察期）", async () => {
    const reg = await twoVersions();
    const ctl = new CanaryController({
      registry: reg,
      workspace: root,
      writeRecord: async () => {
        throw new Error("read-only fs");
      },
    });
    await expect(ctl.begin({ id: "tool.demo-fetch" })).rejects.toThrow(/观察档写不下/);
    expect(ctl.status("tool.demo-fetch")).toBeUndefined();
  });

  it("正向：观察档写盘失败在 observe 上只记账，不改回滚结论", async () => {
    const reg = await twoVersions();
    let fail = true;
    const ctl = new CanaryController({
      registry: reg,
      workspace: root,
      writeRecord: async (path, record) => {
        if (fail) throw new Error("disk full");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify({ version: 1, ...record }), "utf8");
      },
    });
    await expect(ctl.begin({ id: "tool.demo-fetch" })).rejects.toThrow(/观察档写不下/);
    fail = false;
    await ctl.begin({ id: "tool.demo-fetch", maxConsecutiveFailures: 1 });
    fail = true;
    const res = await ctl.observe("tool.demo-fetch", greenSample({ verifyOutcome: "red" }));
    expect(res.observation.state).toBe("rolled-back");
    expect(res.observation.recordWritten).toBe(false);
    expect(res.observation.recordError).toContain("disk full");
    expect((await reg.readIndex()).bundles["tool.demo-fetch"]?.active?.version).toBe("0.1.0");
  });

  it("正向：两个候选各收一个样本（tickAll 一轮喂全部开着的档）", async () => {
    const reg = registry();
    for (const id of ["tool.alpha", "tool.beta"]) {
      await stageBundle(id, "0.1.0");
      await installBundle(reg, id, "0.1.0");
      await stageBundle(id, "0.2.0");
      await installBundle(reg, id, "0.2.0");
    }
    const ctl = new CanaryController({ registry: reg, workspace: root });
    await ctl.begin({ id: "tool.alpha" });
    await ctl.begin({ id: "tool.beta" });
    const restarted = new CanaryController({ registry: reg, workspace: root });
    expect((await restarted.openObservations()).map((o) => o.id)).toEqual(["tool.alpha", "tool.beta"]);
    const ticks = await restarted.tickAll(greenSample());
    expect(ticks.map((t) => [t.id, t.outcome, t.observation?.samples])).toEqual([
      ["tool.alpha", "resumed", 1],
      ["tool.beta", "resumed", 1],
    ]);
  });
});

describe("staging ↔ 账本一致性（只读检查）", () => {
  it("健康账面：ok、零 findings、staged 计数", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await installBundle(reg, "tool.demo-fetch", "0.1.0");
    const report = await checkStagingLedgerConsistency(reg);
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.staged).toBe(1);
  });

  it("孤儿 staging 目录 ⇒ staging-unregistered", async () => {
    const reg = registry();
    await stageBundle("tool.orphan", "0.1.0"); // 只落盘，不注册
    const report = await checkStagingLedgerConsistency(reg);
    expect(report.ok).toBe(false);
    expect(report.findings[0]).toMatchObject({ kind: "staging-unregistered", id: "tool.orphan", version: "0.1.0" });
  });

  it("注册后 staging manifest 被改 ⇒ staging-drift（点名字段）", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    const dir = join(root, "modules", "staging", "tool.demo-fetch", "0.1.0");
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ ...manifest, permissions: ["net.fetch"] }), "utf8");
    const report = await checkStagingLedgerConsistency(reg);
    expect(report.ok).toBe(false);
    const drift = report.findings.find((f) => f.kind === "staging-drift");
    expect(drift?.detail).toContain("staging manifest 与注册定格不一致");
  });

  it("staging 目录路径与 manifest 身份不符 ⇒ staging-identity-mismatch", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    const file = join(root, "modules", "staging", "tool.demo-fetch", "0.1.0", "manifest.json");
    const manifest = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    // 只换版本号：manifest 仍然合契约，坏的是「路径即身份」这一条。
    await writeFile(file, JSON.stringify({ ...manifest, version: "9.9.9" }), "utf8");
    const report = await checkStagingLedgerConsistency(reg);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.kind)).toEqual(["staging-identity-mismatch"]);
  });

  it("staging manifest 坏了 ⇒ staging-manifest-invalid", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await writeFile(join(root, "modules", "staging", "tool.demo-fetch", "0.1.0", "manifest.json"), "{ 这不是 JSON", "utf8");
    const report = await checkStagingLedgerConsistency(reg);
    expect(report.findings.map((f) => f.kind)).toEqual(["staging-manifest-invalid"]);
  });

  it("账本未清退版本的 staging 不见了 ⇒ ledger-staging-missing", async () => {
    const reg = registry();
    await stageBundle("tool.demo-fetch", "0.1.0");
    await reg.registerStaged("tool.demo-fetch", "0.1.0", "evo-pipeline");
    await rm(join(root, "modules", "staging", "tool.demo-fetch"), { recursive: true, force: true });
    const report = await checkStagingLedgerConsistency(reg);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.kind)).toEqual(["ledger-staging-missing"]);
  });
});

describe("canary 跨进程锁：探活优先于时钟（2026-10-19）", () => {
  /** 锁只按 `Date.now() - mtimeMs > 60s` 判陈旧 ⇒ 时钟往回一跳（NTP 校正 / 虚拟机恢复 /
   *  手动改表），一个早就不在的进程留下的锁永远读不出"超时"，canary 从这一秒起永远 refused，
   *  而盘上没有任何东西能解开它。持锁者本来就把 pid 写进了锁文件，却从没读回来过。 */
  const lockPath = (): string => join(root, ".agent", ".canary.lock");

  /** 起一个 controller 并跑一次 tickAll（零档也走取锁这条路：锁在 fn 外面取）。 */
  /** 取不到锁时 CanaryRefusedError 是**抛**出来的（不是塞进结果里），所以这儿要接。
   *  判据关心的是两件事：能不能重取，以及拒的时候有没有把别人的锁删掉。 */
  async function tick(): Promise<{ outcome: string; refused?: string }> {
    const ctl = new CanaryController({ registry: registry(), workspace: root });
    try {
      const r = await ctl.tickAll(greenSample());
      return r.length === 0 ? { outcome: "empty" } : { outcome: r[0]!.outcome, refused: r[0]!.refused };
    } catch (err) {
      if (err instanceof CanaryRefusedError) return { outcome: "refused", refused: err.message };
      throw err;
    }
  }

  it("锁里写着一个**已不在**的 pid，且 mtime 是刚刚（时钟跳回的那一格）⇒ 必须能重取，不永久卡死", async () => {
    await mkdir(dirname(lockPath()), { recursive: true });
    // pid 取一个几乎必然不在的值：Linux pid_max 默认 4194304，这里用远超它的数 + 轮空。
    const deadPid = 2147483646;
    await writeFile(lockPath(), String(deadPid), "utf8");
    // mtime 设为"刚刚"：旧逻辑据此判"不陈旧"⇒ 永久 refused。新逻辑先探活，探到不在就收回。
    const now = new Date();
    await import("node:fs/promises").then((fs) => fs.utimes(lockPath(), now, now));
    const r = await tick();
    expect(r.outcome, "持锁进程已不在，锁必须被收回；否则这一格永远 refused 且盘上无解").not.toBe("refused");
  });

  it("锁里写着**本进程**的 pid（活着）⇒ 照旧拒绝（探活不能变成抢锁）", async () => {
    await mkdir(dirname(lockPath()), { recursive: true });
    await writeFile(lockPath(), String(process.pid), "utf8");
    const r = await tick();
    expect(r.outcome).toBe("refused");
    expect(r.refused).toContain("另一实例正在更新观察档");
    // 拒了就不该把别人的锁文件删掉
    expect(existsSync(lockPath())).toBe(true);
  });

  it("锁文件读不出 pid（空 / 非数字）⇒ 不探活，退回 60s 时间兜底（不猜）", async () => {
    await mkdir(dirname(lockPath()), { recursive: true });
    await writeFile(lockPath(), "", "utf8"); // 崩溃在 open 与 writeFile 之间正是这个形状
    const r = await tick();
    expect(r.outcome).toBe("refused");
    expect(r.refused).toContain("另一实例正在更新观察档");
  });

  it("锁的最终组件是软链 ⇒ 拒绝跟随，也不改写软链目标", async () => {
    await mkdir(dirname(lockPath()), { recursive: true });
    const target = join(root, "outside-lock");
    const original = "2147483646";
    await writeFile(target, original, "utf8");
    await import("node:fs/promises").then((fs) => fs.symlink(target, lockPath()));
    const r = await tick();
    expect(r.outcome).toBe("refused");
    expect(r.refused).toContain("软链");
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("锁是受害文件的 hardlink ⇒ 拒绝接管，也不写穿受害文件", async () => {
    await mkdir(dirname(lockPath()), { recursive: true });
    const victim = join(root, "outside-lock");
    const original = "84713";
    await writeFile(victim, original, "utf8");
    await link(victim, lockPath());
    const r = await tick();
    expect(r.outcome).toBe("refused");
    expect(r.refused).toContain("独立常规文件");
    expect(await readFile(victim, "utf8")).toBe(original);
  });

  it("零档取锁 ⇒ 不顺手建出 `.agent/canary/`（既有判据：没有档 = 目录不存在）", async () => {
    const r = await tick();
    expect(r.outcome).toBe("empty");
    expect(existsSync(join(root, ".agent", "canary"))).toBe(false);
    // 释放只标记同一 inode，不按锁路径删除，避免释放阶段的路径 ABA。
    expect(await readFile(lockPath(), "utf8")).toBe("released");
  });
});
