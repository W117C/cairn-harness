import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import {
  applyPlaybookEvents,
  bodyChangeRatio,
  canInject,
  detectConflicts,
  newExperience,
  renderPlaybookNote,
  retrieveExperiences,
  validateExperience,
  type ExperienceEntry,
  type NewExperienceInput,
  type PlaybookOp,
  type RetrievalContext,
} from "../src/agent/evolve/playbook";
import { projectEpisode, type EpisodeRecord } from "../src/agent/evolve";
import { shadowReport } from "../src/agent/evolve/shadow";

const NOW = 10_000;

function make(overrides: Partial<NewExperienceInput> = {}): ExperienceEntry {
  return newExperience({
    kind: "warning",
    scope: { workspace: "/w" },
    trigger: { when: "always" },
    body: "先看 tsconfig 的 paths，再改业务代码",
    evidenceEpisodes: [],
    now: NOW,
    ...overrides,
  });
}

function active(overrides: Partial<NewExperienceInput> = {}): ExperienceEntry {
  return make({ status: "active", evidenceEpisodes: ["ep_1"], ...overrides });
}

function add(entry: ExperienceEntry, evidence: string[] = []): PlaybookOp {
  return { v: 1, op: "add", ts: NOW, entry, evidence, reason: "test" };
}

function ctx(overrides: Partial<RetrievalContext> = {}): RetrievalContext {
  return {
    workspace: "/w",
    taskClass: "debug",
    tokens: ["parser"],
    signals: ["cost-high"],
    toolNames: ["edit_file"],
    paths: ["src/parser.ts"],
    now: NOW,
    ...overrides,
  };
}

function episode(outcome: "success" | "failure"): EpisodeRecord {
  const meta = { type: "session_meta", ts: NOW } as unknown as AgentEvent;
  const user = { type: "user_message", content: "修复 parser 的报错" } as AgentEvent;
  const usage = { type: "usage", inputTokens: 10, outputTokens: 2 } as AgentEvent;
  const verify = outcome === "success"
    ? { type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 1, results: [] } as AgentEvent
    : {
      type: "verify_result", callId: "v", ok: false, attempt: 1, maxAttempts: 1,
      results: [{ command: "pnpm test", ok: false, output: "fail" }], cause: "code",
    } as AgentEvent;
  return projectEpisode({
    events: [meta, user, verify, usage],
    workspace: "/w",
    sessionId: "s_" + outcome,
    logPath: "/w/e.jsonl",
    observedAt: NOW,
  });
}

describe("Playbook 生命周期", () => {
  it("只有 active 且未过期才可注入", () => {
    expect(canInject(active(), NOW + 1)).toBe(true);
    expect(canInject(make(), NOW + 1)).toBe(false);
    expect(canInject(active({ expiresAt: NOW - 1 }), NOW)).toBe(false);
  });

  it("add 同 id 不覆盖；无证据不能 active", () => {
    const entry = make();
    expect(applyPlaybookEvents([add(entry)]).entries).toHaveLength(1);
    const duplicate = applyPlaybookEvents([add(entry), add(entry)]);
    expect(duplicate.refusals).toHaveLength(1);
    expect(duplicate.refusals[0]!.reason).toContain("已存在");

    const noEvidence = make({ status: "active" });
    const refused = applyPlaybookEvents([add(noEvidence)]);
    expect(refused.entries).toHaveLength(0);
    expect(refused.refusals[0]!.reason).toContain("证据");
  });

  it("patch 只接受有界 body 增量", () => {
    const entry = make({ body: "第一句。第二句。" });
    const bad = applyPlaybookEvents([
      add(entry),
      {
        v: 1, op: "patch", ts: NOW + 1, id: entry.id,
        fields: { body: "完全不同的另一段长文本，长度明显超过百分之三十的阈值" },
        evidence: ["ep_2"], reason: "rewrite",
      },
    ]);
    expect(bad.refusals[0]!.reason).toContain("30");
    expect(bodyChangeRatio("第一句。第二句。", "完全不同的另一段长文本")).toBeGreaterThan(0.3);

    const ok = applyPlaybookEvents([
      add(entry),
      { v: 1, op: "patch", ts: NOW + 1, id: entry.id, fields: { body: "第一句。第二句！" }, evidence: ["ep_2"], reason: "small" },
    ]);
    expect(ok.refusals).toEqual([]);
    expect(ok.entries[0]!.body).toBe("第一句。第二句！");
    expect(ok.entries[0]!.evidence.episodes).toContain("ep_2");
  });

  it("merge/split 保留证据并退役旧条目", () => {
    const a = active({ body: "A" });
    const b = active({ body: "B" });
    const c = make({ id: "exp_0123456789abcdef", status: "active", evidenceEpisodes: ["ep_1"], body: "C" });
    const merged = applyPlaybookEvents([
      add(a, ["ep_1"]), add(b, ["ep_2"]),
      { v: 1, op: "merge", ts: NOW + 1, ids: [a.id, b.id], into: c, evidence: ["ep_3"], reason: "merge" },
    ]);
    expect(merged.refusals).toEqual([]);
    const mergedById = new Map(merged.entries.map((entry) => [entry.id, entry]));
    expect(mergedById.get(a.id)!.status).toBe("retired");
    expect(mergedById.get(b.id)!.status).toBe("retired");
    expect(mergedById.get(c.id)!.status).toBe("active");
    expect([...mergedById.get(c.id)!.evidence.episodes].sort()).toEqual(["ep_1", "ep_2", "ep_3"]);

    const d = make({ id: "exp_1111111111111111", status: "active", evidenceEpisodes: ["ep_4"], body: "D" });
    const e = make({ id: "exp_2222222222222222", status: "active", evidenceEpisodes: ["ep_5"], body: "E" });
    const split = applyPlaybookEvents([
      add(c, ["ep_1"]),
      { v: 1, op: "split", ts: NOW + 2, id: c.id, into: [d, e], evidence: ["ep_6"], reason: "split" },
    ]);
    expect(split.refusals).toEqual([]);
    const splitById = new Map(split.entries.map((entry) => [entry.id, entry]));
    expect(splitById.get(c.id)!.status).toBe("retired");
    expect(splitById.get(d.id)!.status).toBe("active");
    expect([...splitById.get(d.id)!.evidence.episodes].sort()).toEqual(["ep_1", "ep_4", "ep_6"]);
  });

  it("validate 拒绝越界字段", () => {
    expect(validateExperience(make())).toEqual([]);
    expect(validateExperience({ ...make(), body: "x".repeat(801) }).some((s) => s.includes("body"))).toBe(true);
    expect(validateExperience({ ...make(), id: "bad" }).some((s) => s.includes("id"))).toBe(true);
  });
});

describe("Playbook 检索与渲染", () => {
  it("按 scope/trigger 过滤并遵守预算", () => {
    const always = active({ body: "always" });
    const debug = active({ kind: "strategy", scope: { workspace: "/w", taskClass: "debug" }, trigger: { when: "on-task-class" }, body: "debug" });
    const cost = active({ kind: "policy", scope: { workspace: "/w" }, trigger: { when: "on-signal", signal: "cost-high" }, body: "cost" });
    const other = active({ scope: { workspace: "/other" }, trigger: { when: "always" }, body: "other" });

    const got = retrieveExperiences([always, debug, cost, other], ctx());
    expect([...got.selected.map((entry) => entry.id)].sort()).toEqual([always.id, debug.id, cost.id].sort());
    expect(got.skipped.some((item) => item.id === other.id && item.reason === "scope")).toBe(true);

    const limited = retrieveExperiences([always, debug, cost, other], ctx(), { maxEntries: 2 });
    expect(limited.selected).toHaveLength(2);
    expect(limited.skipped.some((item) => item.reason === "budget")).toBe(true);

    const noSignal = retrieveExperiences([always, debug, cost, other], ctx({ signals: [] }));
    expect(noSignal.selected.map((entry) => entry.id)).not.toContain(cost.id);
  });

  it("同分同证据时，任务词面更近的条目优先（Jaccard 项）", () => {
    const relevant = active({ id: "exp_ffffffffffffffff", trigger: { when: "on-signal", signal: "cost-high" }, body: "先看 tsconfig 的 paths，再改业务代码" });
    const noise = active({ id: "exp_0000000000000000", trigger: { when: "on-signal", signal: "goal-drift" }, body: "提交前检查变更清单" });
    const got = retrieveExperiences(
      [relevant, noise],
      ctx({ tokens: ["tsconfig", "paths"], signals: ["cost-high", "goal-drift"] }),
      { maxEntries: 1 },
    );
    expect(got.selected.map((entry) => entry.id)).toEqual([relevant.id]);
  });

  it("同触发的 active 条目冲突时都不注入", () => {
    const a = active({ body: "A" });
    const b = active({ body: "B" });
    expect(detectConflicts([a, b])).toHaveLength(1);
    const got = retrieveExperiences([a, b], ctx());
    expect(got.selected).toHaveLength(0);
    expect(got.skipped.filter((item) => item.reason === "conflict")).toHaveLength(2);
  });

  it("render 只渲染选中条目并带证据；空选择为空串", () => {
    const entry = active({ evidenceEpisodes: ["ep_1", "ep_2"], body: "先看 paths" });
    const text = renderPlaybookNote([entry]);
    expect(text).toContain(entry.id);
    expect(text).toContain("warning");
    expect(text).toContain("先看 paths");
    expect(text).toContain("ep_1");
    expect(renderPlaybookNote([])).toBe("");
  });
});

describe("Shadow", () => {
  it("候选条目在 shadow 中可命中，并分成功/失败计数", () => {
    const candidate = make({ trigger: { when: "always" }, body: "shadow candidate" });
    const report = shadowReport([episode("success"), episode("failure")], [candidate]);
    expect(report.totalHits).toBe(2);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.id).toBe(candidate.id);
    expect(report.entries[0]!.hitsByOutcome).toEqual({ success: 1, failure: 1, unknown: 0 });
    expect(report.entries[0]!.signal).toContain("无法区分");
    expect(report.entries[0]!.status).toBe("candidate");
  });
});
