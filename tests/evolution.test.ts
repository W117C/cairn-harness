import { describe, it, expect } from "vitest";
import { extractSignals } from "../src/agent/evolution/signal.js";
import { strategyPatches, renderPatches, anchorText, MAX_PATCHES_PER_RUN, COST_PER_BOUNDARY_LIMIT } from "../src/agent/evolution/strategy-patch.js";
import { evaluatePatchEffects, carryOverPatches, renderEffects, patchKeyOf } from "../src/agent/evolution/patch-effect.js";
import { evolutionAdvice, hasAdvice, renderAdvice } from "../src/agent/evolution/advice.js";
import { runEvolution, loadEvolution, evolutionPromptNote, persistEvolution } from "../src/agent/evolution/index.js";
import type { EvolutionSignals } from "../src/agent/evolution/signal.js";
import type { StrategyPatch } from "../src/agent/evolution/strategy-patch.js";
import type { AgentEvent } from "../src/events/index.js";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ev = (e: Record<string, unknown>): AgentEvent => e as unknown as AgentEvent;

describe("evolution extractSignals", () => {
  it("counts verify failures by cause and flags repeated cause ≥3", () => {
    const events: AgentEvent[] = [
      ev({ type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, cause: "pkg-manager", results: [] }),
      ev({ type: "verify_result", callId: "v2", ok: false, attempt: 2, maxAttempts: 3, cause: "pkg-manager", results: [] }),
      ev({ type: "verify_result", callId: "v3", ok: false, attempt: 3, maxAttempts: 3, cause: "pkg-manager", results: [] }),
    ];
    const s = extractSignals(events);
    expect(s.verifyFailuresByCause["pkg-manager"]).toBe(3);
    expect(s.repeatedVerifyCause).toBe("pkg-manager");
    expect(s.verifyOutcome).toBe("red");
  });

  it("green when last verify ok", () => {
    const events: AgentEvent[] = [
      ev({ type: "verify_result", callId: "v1", ok: true, attempt: 1, maxAttempts: 3, results: [] }),
    ];
    expect(extractSignals(events).verifyOutcome).toBe("green");
    expect(extractSignals(events).repeatedVerifyCause).toBeNull();
  });

  it("no verify ⇒ verifyOutcome none", () => {
    expect(extractSignals([]).verifyOutcome).toBe("none");
  });

  it("同一会话的新一轮没有 verify ⇒ 不继承上一轮的连败升级", () => {
    const events: AgentEvent[] = [
      ev({ type: "user_message", content: "上一轮" }),
      ev({ type: "verify_result", callId: "v1", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "v2", ok: false, cause: "code", attempt: 2, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "v3", ok: false, cause: "code", attempt: 3, maxAttempts: 3, results: [] }),
      ev({ type: "user_message", content: "这一轮未验证" }),
    ];

    const s = extractSignals(events);
    expect(s.verifyOutcome).toBe("none");
    expect(s.verifyFailuresByCause).toEqual({});
    expect(s.repeatedVerifyCause).toBeNull();
    expect(evaluatePatchEffects([verifyPatch], s)[0]).toMatchObject({
      status: "inconclusive",
      disposition: "observe",
    });
  });

  it("worker 的 verify 绿色不覆盖父会话的失败读数", () => {
    const events: AgentEvent[] = [
      ev({ type: "user_message", content: "父会话" }),
      ev({ type: "verify_result", callId: "parent-red", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "worker-green", ok: true, attempt: 1, maxAttempts: 3, results: [], agent_id: "worker-1" }),
    ];

    const s = extractSignals(events);
    expect(s.verifyOutcome).toBe("red");
    expect(s.lastVerifyFailureCause).toBe("code");
    expect(s.verifyFailuresByCause).toEqual({ code: 1 });
  });
});

describe("evolution strategyPatches", () => {
  it("emits verify-escalate on repeated cause", () => {
    const s = extractSignals([
      ev({ type: "verify_result", callId: "v1", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "v2", ok: false, cause: "code", attempt: 2, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "v3", ok: false, cause: "code", attempt: 3, maxAttempts: 3, results: [] }),
    ]);
    const p = strategyPatches(s);
    expect(p.some((x) => x.kind === "verify-escalate" && x.cause === "code")).toBe(true);
  });

  it("emits nothing when signals are clean (no false positive)", () => {
    const p = strategyPatches({
      verifyFailuresByCause: {}, repeatedVerifyCause: null, verifyOutcome: "green",
      goalDriftCount: 0, costMeasurable: true, tokensPerBoundary: 1000, spendAfterLastBoundary: 0, eventCount: 5,
    });
    expect(p).toHaveLength(0);
  });

  it("bounds patches to MAX_PATCHES_PER_RUN", () => {
    const p = strategyPatches({
      verifyFailuresByCause: { code: 5 }, repeatedVerifyCause: "code", verifyOutcome: "red",
      goalDriftCount: 3, costMeasurable: true, tokensPerBoundary: 999_000, spendAfterLastBoundary: 0, eventCount: 100,
    });
    expect(p.length).toBeLessThanOrEqual(MAX_PATCHES_PER_RUN);
  });

  // 第 447 页：这句进的是模型可见面，而 `tests/promise-recall-inventory.test.ts` 那条尺的
  // 欠证人帽是 **0** ⇒ 每句都要有原句证人。断的是生产端那一整段连续字面量，不是某个关键词。
  it("目标漂移那条 patch 的正文点名「这一轮开工前先复述当前目标与」（时间代词站在读者这侧）", () => {
    const p = strategyPatches({
      verifyFailuresByCause: {}, repeatedVerifyCause: null, verifyOutcome: "green",
      goalDriftCount: 2, costMeasurable: true, tokensPerBoundary: 1000, spendAfterLastBoundary: 0, eventCount: 5,
    });
    const drift = p.find((x) => x.kind === "goal-reconfirm");
    expect(drift, "漂移信号没产出 patch ⇒ 那句话没有读者").toBeDefined();
    expect(drift!.note).toContain("这一轮开工前先复述当前目标与");
  });

  it("renderPatches produces empty string for no patches", () => {
    expect(renderPatches([])).toBe("");
  });

  it("legacy code advice is rendered from its cause, not stale stored wording", () => {
    const legacy: StrategyPatch = {
      kind: "verify-escalate",
      cause: "code",
      times: 3,
      note: "同一 verify 失败 cause=code 连续 3 次——这多半是环境/工具链问题，不是代码可改；这一轮先排查环境。",
    };
    const rendered = renderPatches([legacy]);
    expect(rendered).toContain("失败归因是代码问题");
    expect(rendered).not.toContain("环境/工具链问题");
  });
});

describe("evolution store + wiring", () => {
  it("runEvolution persists and loadEvolution reads back", async () => {
    const ws = await mkdtemp(join(tmpdir(), "evo-"));
    try {
      const events: AgentEvent[] = [
        ev({ type: "verify_result", callId: "v1", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
        ev({ type: "verify_result", callId: "v2", ok: false, cause: "code", attempt: 2, maxAttempts: 3, results: [] }),
        ev({ type: "verify_result", callId: "v3", ok: false, cause: "code", attempt: 3, maxAttempts: 3, results: [] }),
      ];
      const res = await runEvolution(events, ws, "test-session.jsonl");
      expect(res.persistedTo).not.toBeNull();
      expect(res.patches.length).toBeGreaterThan(0);
      const rec = await loadEvolution(ws);
      expect(rec).not.toBeNull();
      expect(rec!.patches).toHaveLength(res.patches.length);
      expect(rec!.fromSession).toBe("test-session.jsonl");
      const note = await evolutionPromptNote(ws);
      expect(note).toContain("[evolution]");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("loadEvolution returns null on missing/corrupt file (fail-closed, no fabrication)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "evo-"));
    try {
      expect(await loadEvolution(ws)).toBeNull();
      const note = await evolutionPromptNote(ws);
      expect(note).toBe("");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("invalid optional effect data is rejected instead of crashing prompt rendering", async () => {
    const ws = await mkdtemp(join(tmpdir(), "evo-invalid-effects-"));
    try {
      await mkdir(join(ws, ".agent"), { recursive: true });
      await writeFile(join(ws, ".agent", "evolution.json"), JSON.stringify({
        version: 1,
        patches: [],
        effects: { malformed: true },
        ts: 1,
      }), "utf8");
      expect(await loadEvolution(ws)).toBeNull();
      expect(await evolutionPromptNote(ws)).toBe("");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("reverse validation: no repeated cause ⇒ no verify-escalate patch", () => {
    const s = extractSignals([
      ev({ type: "verify_result", callId: "v1", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
      ev({ type: "verify_result", callId: "v2", ok: true, attempt: 2, maxAttempts: 3, results: [] }),
    ]);
    expect(s.repeatedVerifyCause).toBeNull();
    expect(strategyPatches(s).some((x) => x.kind === "verify-escalate")).toBe(false);
  });
});

/* ---------- 跨轮闭环（2026-10-16）：上一轮的补丁这一轮生效没有 ---------- */

const sig = (over: Partial<EvolutionSignals> = {}): EvolutionSignals => ({
  verifyFailuresByCause: {},
  repeatedVerifyCause: null,
  verifyOutcome: "green",
  goalDriftCount: 0,
  costMeasurable: true,
  tokensPerBoundary: 1_000,
  spendAfterLastBoundary: 0,
  eventCount: 10,
  ...over,
});

const verifyPatch: StrategyPatch = {
  kind: "verify-escalate",
  cause: "code",
  times: 3,
  note: "同一 verify 失败 cause=code 连续 3 次——这多半是环境/工具链问题，不是代码可改；这一轮先排查环境。",
};
const goalPatch: StrategyPatch = { kind: "goal-reconfirm", driftCount: 3, note: "旧提示" };
const costPatch: StrategyPatch = { kind: "cost-throttle", tokensPerBoundary: 60_000, note: "旧提示" };
const deathPatch: StrategyPatch = { kind: "cost-throttle", tokensPerBoundary: null, note: "旧提示" };

describe("跨轮闭环：补丁效果评估", () => {
  it("verify 连败：本轮转绿未再出现该 cause ⇒ 已消解/不再重复发", () => {
    const eff = evaluatePatchEffects([verifyPatch], sig({ verifyOutcome: "green" }));
    expect(eff).toHaveLength(1);
    expect(eff[0]!.key).toBe("verify-escalate:code");
    expect(eff[0]!.status).toBe("resolved");
    expect(eff[0]!.disposition).toBe("drop");
    expect(eff[0]!.observed).toContain("上次读数 verify 全绿");
  });

  it("verify 连败：同类问题复发 ⇒ 不比上轮轻就升级、有缓解则保持", () => {
    const worse = evaluatePatchEffects([verifyPatch], sig({ verifyOutcome: "red", verifyFailuresByCause: { code: 3 } }));
    expect(worse[0]!.status).toBe("recurred");
    expect(worse[0]!.disposition).toBe("escalate");
    expect(worse[0]!.observed).toContain("又失败 3 次");
    const softer = evaluatePatchEffects([verifyPatch], sig({ verifyOutcome: "red", verifyFailuresByCause: { code: 1 } }));
    expect(softer[0]!.status).toBe("recurred");
    expect(softer[0]!.disposition).toBe("keep");
  });

  it("verify 最终仍红、但最后原因已切换 ⇒ 不接续另一种故障的旧建议", () => {
    const effect = evaluatePatchEffects([verifyPatch], sig({
      verifyOutcome: "red",
      verifyFailuresByCause: { code: 1, timeout: 1 },
      lastVerifyFailureCause: "timeout",
    }));
    expect(effect[0]).toMatchObject({ status: "resolved", disposition: "drop" });
    expect(effect[0]!.observed).toContain("timeout");
  });

  it("verify 连败：本轮没有 verify 拍 ⇒ 不可判/继续观察（不可测不等于已消解）", () => {
    const eff = evaluatePatchEffects([verifyPatch], sig({ verifyOutcome: "none" }));
    expect(eff[0]!.status).toBe("inconclusive");
    expect(eff[0]!.disposition).toBe("observe");
    expect(eff[0]!.observed).toContain("不可测不等于已消解");
  });

  it("目标复述：漂移归零 ⇒ 已消解；多于上轮 ⇒ 升级；少于上轮 ⇒ 保持", () => {
    expect(evaluatePatchEffects([goalPatch], sig({ goalDriftCount: 0 }))[0]).toMatchObject({ status: "resolved", disposition: "drop" });
    expect(evaluatePatchEffects([goalPatch], sig({ goalDriftCount: 5 }))[0]).toMatchObject({ status: "recurred", disposition: "escalate" });
    expect(evaluatePatchEffects([goalPatch], sig({ goalDriftCount: 2 }))[0]).toMatchObject({ status: "recurred", disposition: "keep" });
    expect(evaluatePatchEffects([goalPatch], sig({ goalDriftCount: 2 }))[0]!.observed).toContain("目标漂移 2 处（补丁发出时 3 处）");
  });

  it("成本节流：回落到偏高线内 ⇒ 已消解；仍高于线 ⇒ 更贵升级/变便宜保持", () => {
    expect(evaluatePatchEffects([costPatch], sig({ tokensPerBoundary: COST_PER_BOUNDARY_LIMIT }))[0]!.status).toBe("resolved");
    expect(evaluatePatchEffects([costPatch], sig({ tokensPerBoundary: 90_000 }))[0]).toMatchObject({ status: "recurred", disposition: "escalate" });
    expect(evaluatePatchEffects([costPatch], sig({ tokensPerBoundary: 50_000 }))[0]).toMatchObject({ status: "recurred", disposition: "keep" });
  });

  it("成本节流反向臂：不可测（有支出或无支出）⇒ 一律不可判，不折成 0 也不折成复发", () => {
    // 2026-10-16：从前"不可测 + 边界后还在烧"被读成死跑复发并 escalate，于是一条由不可测
    // 推出的旧补丁会一轮轮自我确认、越升越硬。可测才谈得上消解或复发。
    const burning = evaluatePatchEffects([costPatch], sig({ costMeasurable: false, tokensPerBoundary: null, spendAfterLastBoundary: 800 }));
    expect(burning[0]).toMatchObject({ status: "inconclusive", disposition: "observe" });
    expect(burning[0]!.observed).toContain("不可测");
    expect(burning[0]!.observed).not.toContain("死跑复发");
    const dark = evaluatePatchEffects([costPatch], sig({ costMeasurable: false, tokensPerBoundary: null, spendAfterLastBoundary: 0 }));
    expect(dark[0]).toMatchObject({ status: "inconclusive", disposition: "observe" });
  });

  it("死跑补丁：转成可测且便宜 ⇒ 已消解；仍不可测 ⇒ 不可判（不是复发升级）", () => {
    const ok = evaluatePatchEffects([deathPatch], sig({ tokensPerBoundary: 10_000 }));
    expect(ok[0]!.status).toBe("resolved");
    const back = evaluatePatchEffects([deathPatch], sig({ costMeasurable: false, tokensPerBoundary: null, spendAfterLastBoundary: 5_000 }));
    expect(back[0]!.status).toBe("inconclusive");
    expect(back[0]!.disposition).toBe("observe");
  });

  it("接续：已消解的不再挂着；复发/不可判且本轮没再生成同类补丁的接回；同类只留一份", () => {
    const resolved = evaluatePatchEffects([goalPatch], sig({ goalDriftCount: 0 }));
    expect(carryOverPatches(resolved, [])).toHaveLength(0);
    const kept = evaluatePatchEffects([goalPatch], sig({ goalDriftCount: 2 }));
    expect(carryOverPatches(kept, [])).toHaveLength(1);
    // 本轮自己又生成了同类补丁 ⇒ 不重复接
    expect(carryOverPatches(kept, [goalPatch])).toHaveLength(0);
    expect(patchKeyOf(goalPatch)).toBe("goal-reconfirm");
  });
});

describe("跨轮闭环：决策建议出口", () => {
  it("成本偏高 ⇒ 降档 + 提前压缩；健康读数 ⇒ 不干涉（没有依据就不给建议）", () => {
    const high = evolutionAdvice(sig({ tokensPerBoundary: 120_000 }));
    expect(high).toMatchObject({ preferredTier: "cheap", contextAction: "compress-early" });
    expect(high.reasons[0]).toContain("120000");
    // 不可测 ⇒ 不干涉（2026-10-16）：从前这里产出 stop-after-boundary，把"没有测量能力"
    // 读成"没有前进"。实测代价：一场真的生成了 HTML、自动检查也过了的会话被记成
    // "130535 token 且无新前进 / 死跑复发"，下一轮系统提示词带着这句劝退。
    const dark = evolutionAdvice(sig({ costMeasurable: false, tokensPerBoundary: null, spendAfterLastBoundary: 9_000 }));
    expect(dark).toMatchObject({ preferredTier: null, contextAction: null });
    expect(dark.reasons).toEqual([]);
  });

  it("不可测且还在烧 ⇒ 一个字都不说（不可测不是 0，也不是「该停了」）", () => {
    // 这一格钉的是"不说"本身：那句话会被拼进下一轮 system prompt，所以哪怕
    // spendAfterLastBoundary 很大，只要不可测就不该出现任何建议。
    for (const spend of [1, 9_000, 130_535]) {
      const a = evolutionAdvice(sig({ costMeasurable: false, tokensPerBoundary: null, spendAfterLastBoundary: spend }));
      expect(hasAdvice(a), "spend=" + String(spend) + " 时居然给了建议").toBe(false);
      expect(renderAdvice(a)).toBe("");
    }
  });

  it("成本偏高仍是唯一出口：不可测不再派生任何 contextAction", () => {
    // 与上一格互补：可测且偏高 ⇒ 照旧给建议（这条没被一起削掉）。
    const high = evolutionAdvice(sig({ tokensPerBoundary: 90_000 }));
    expect(high.contextAction).toBe("compress-early");
    const dark = evolutionAdvice(sig({ costMeasurable: false, tokensPerBoundary: null, spendAfterLastBoundary: 90_000 }));
    expect(dark.contextAction).toBeNull();
    const quiet = evolutionAdvice(sig());
    expect(quiet.preferredTier).toBeNull();
    expect(quiet.contextAction).toBeNull();
    expect(quiet.reasons).toEqual([]);
    expect(renderAdvice(quiet)).toBe("");
  });

  // 这三句进的是模型可见面（下一轮 system prompt），`tests/promise-recall-inventory.test.ts`
  // 对能力断言的欠证人帽是 0 ⇒ 每句都要有原句证人（断生产端连续字面量，不是关键词）。
  it("建议句与跨轮评估句都能渲染出来（原句证人）", () => {
    expect(renderAdvice(evolutionAdvice(sig({ tokensPerBoundary: 120_000 })))).toContain("把贵档留给真正卡住的环节");
    expect(renderAdvice(evolutionAdvice(sig({ tokensPerBoundary: 120_000 })))).toContain("别等撞上预算上限");
    // 「该停就停」那句已撤：它由不可测推导，而不可测不等于无前进（见 advice.ts 那段注释）。
    // 这里钉的是**这句不再出现**，防止有人换个写法把它加回来。
    expect(renderAdvice(evolutionAdvice(sig({ costMeasurable: false, spendAfterLastBoundary: 1 })))).toBe("");
    const eff = renderEffects(evaluatePatchEffects([goalPatch], sig({ goalDriftCount: 0 })));
    expect(eff).toContain("[evolution] 上一轮补丁的跨轮评估");
    expect(eff).toContain("这一轮不再重复发");
    expect(renderEffects([])).toBe("");
  });
});

/* ---------- 段落自报时刻 + 时间代词纪律（2026-10-16） ---------- */

/** 本地时间 YYYY-MM-DD HH:mm；测试侧独立实现（钉「锚在不在、指的是不是那一秒」，
 *  不把生产端 anchorText 抄进断言里当同义反复）。 */
function localStamp(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => (n < 10 ? "0" : "") + String(n);
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

describe("跨轮提示：段落自报时刻（时间锚）", () => {
  const TS = Date.UTC(2026, 9, 16, 13, 3);
  const goalEffect = evaluatePatchEffects([goalPatch], sig({ goalDriftCount: 0 }));

  it("三段都认 recordedAt：带上就印「记于 本地时刻」", () => {
    expect(anchorText(TS)).toBe(localStamp(TS));
    expect(renderPatches([goalPatch], TS)).toContain("记于 " + localStamp(TS));
    expect(renderEffects(goalEffect, TS)).toContain("（记于 " + localStamp(TS) + "）");
    expect(renderAdvice(evolutionAdvice(sig({ tokensPerBoundary: 120_000 })), TS)).toContain("（记于 " + localStamp(TS) + "）");
  });

  it("缺省不带锚：形状与从前逐字一致（老调用方零行为）", () => {
    expect(renderPatches([goalPatch])).not.toContain("记于");
    expect(renderEffects(goalEffect)).not.toContain("记于");
    expect(renderAdvice(evolutionAdvice(sig({ tokensPerBoundary: 120_000 })))).not.toContain("记于");
    // 空内容时连锚一起省（空串仍是空串，不因为带了时刻就冒出一段空提示）。
    expect(renderPatches([], TS)).toBe("");
    expect(renderEffects([], TS)).toBe("");
  });

  it("锚指的是那一次落盘的时刻（同一个记录 ts 喂三段，印的是同一秒）", () => {
    const other = TS + 86_400_000;
    expect(renderEffects(goalEffect, other)).toContain("（记于 " + localStamp(other) + "）");
    expect(renderEffects(goalEffect, other)).not.toContain("（记于 " + localStamp(TS) + "）");
  });
});

describe("跨轮提示：时间代词站在读者这侧", () => {
  it("三段正文都不出现会随时间读歪的「本轮」/「下一轮」", () => {
    const note =
      renderAdvice(evolutionAdvice(sig({ tokensPerBoundary: 120_000 })), 0) +
      renderEffects(evaluatePatchEffects([verifyPatch, goalPatch, costPatch, deathPatch], sig({ verifyOutcome: "red", verifyFailuresByCause: { code: 3 }, goalDriftCount: 4, tokensPerBoundary: 90_000, spendAfterLastBoundary: 500 })));
    expect(note.length).toBeGreaterThan(0);
    expect(note).not.toContain("本轮");
    expect(note).not.toContain("下一轮");
  });

  it("patch 正文的时间代词站在读者这侧（三种 kind 各断原句，不拿关键词当针脚）", () => {
    const p = strategyPatches({
      verifyFailuresByCause: { code: 3 }, repeatedVerifyCause: "code", verifyOutcome: "red",
      goalDriftCount: 2, costMeasurable: true, tokensPerBoundary: 99_000, spendAfterLastBoundary: 0, eventCount: 9,
    });
    const byKind = new Map(p.map((one) => [one.kind, one.note] as const));
    expect(p).toHaveLength(3);
    expect(byKind.get("verify-escalate")).toContain("失败归因是代码问题；这一轮先根据失败输出定位问题并改变诊断或修复路径");
    expect(byKind.get("goal-reconfirm")).toContain("这一轮开工前先复述当前目标与「不做什么」，对齐了再动手");
    expect(byKind.get("cost-throttle")).toContain("这一轮提前压缩上下文、路由优先走便宜档");
  });
});

describe("跨轮闭环：编排与落盘", () => {
  it("runEvolution 读上一轮、识别最终恢复并从下一轮建议中移除旧补丁", async () => {
    const ws = await mkdtemp(join(tmpdir(), "evo-loop-"));
    try {
      await persistEvolution(ws, [verifyPatch], "seed.jsonl");
      const events: AgentEvent[] = [
        ev({ type: "verify_result", callId: "v1", ok: false, cause: "code", attempt: 1, maxAttempts: 3, results: [] }),
        ev({ type: "verify_result", callId: "v2", ok: true, attempt: 2, maxAttempts: 3, results: [] }),
      ];
      const res = await runEvolution(events, ws, "loop.jsonl");
      expect(res.effects).toHaveLength(1);
      expect(res.effects[0]).toMatchObject({ status: "resolved", disposition: "drop" });
      expect(res.patches).toEqual([]);
      const raw = JSON.parse(await readFile(join(ws, ".agent", "evolution.json"), "utf8")) as {
        effects?: unknown[];
        advice?: unknown;
        fromSession?: string;
      };
      expect(raw.fromSession).toBe("loop.jsonl");
      expect(raw.effects).toHaveLength(1);
      expect(raw.advice).toBeUndefined(); // 本轮没有成本读数 ⇒ 空建议不落盘
      const note = await evolutionPromptNote(ws);
      expect(note).toContain("[evolution]");
      expect(note).toContain("上一轮补丁的跨轮评估");
      expect(note).not.toContain("先排查环境");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("下一轮转绿 ⇒ 判定已消解、补丁不再重发；建议随记录渲染", async () => {
    const ws = await mkdtemp(join(tmpdir(), "evo-loop-"));
    try {
      await persistEvolution(ws, [verifyPatch], "seed.jsonl");
      const res = await runEvolution(
        [ev({ type: "verify_result", callId: "v9", ok: true, attempt: 1, maxAttempts: 3, results: [] })],
        ws,
        "next.jsonl",
      );
      expect(res.effects[0]!.status).toBe("resolved");
      expect(res.patches).toHaveLength(0);
      const note = await evolutionPromptNote(ws);
      expect(note).toContain("这一轮不再重复发");
      // 建议单独落盘 → 装配时按同一份渲染（结构化出口与提示词同源）。
      await persistEvolution(ws, res.patches, "next.jsonl", {
        effects: res.effects,
        advice: evolutionAdvice(sig({ tokensPerBoundary: 120_000 })),
      });
      const note2 = await evolutionPromptNote(ws);
      expect(note2).toContain("上一次读数推出的决策建议");
      expect(note2).toContain("把贵档留给真正卡住的环节");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
