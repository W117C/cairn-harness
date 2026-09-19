// 门禁耗时账本（spec §4「观测值一律生成，不手抄」；spec 在
// docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md）。
//
// 动因是散文里那句"~800s 的 test 门"：gates.ts 当场就算得出每道门的 ms，抄进文档就成了一颗
// 会漂 15 倍的假常量。这里把它落成生成物 + 一条读表命令，文档只写指针。
import { describe, expect, it } from "vitest";
import { formatFacts, formatRuns, pushRun, summarize, FACTS_RUN_CAP, type FactsLedger, type RunEntry } from "../scripts/facts";

const run = (ts: string, gate: string, ms: number, exit = 0, unverified = 0): RunEntry => ({
  ts, host: "testhost", gates: [{ gate, exit, ms, unverified }],
});

const ledger = (...runs: RunEntry[]): FactsLedger => runs.reduce<FactsLedger>((acc, r) => pushRun(acc, r), { version: 1, runs: [] });

describe("pushRun（环形账本）", () => {
  it("对空账本建账", () => {
    const l = pushRun(null, run("2026-09-19T00:00:00Z", "test", 100));
    expect(l.runs).toHaveLength(1);
    expect(l.runs[0]!.gates[0]!.gate).toBe("test");
  });

  it("超过上限时丢最旧的那次，保留最近的", () => {
    let l: FactsLedger = { version: 1, runs: [] };
    for (let i = 0; i < FACTS_RUN_CAP + 3; i++) l = pushRun(l, run("t" + String(i), "test", i));
    expect(l.runs).toHaveLength(FACTS_RUN_CAP);
    expect(l.runs[0]!.ts).toBe("t3");
    expect(l.runs[l.runs.length - 1]!.ts).toBe("t" + String(FACTS_RUN_CAP + 2));
  });

  it("一次整跑 = 一个条目（多道门同属一次）", () => {
    const l = pushRun({ version: 1, runs: [] }, {
      ts: "X", host: "h", gates: [{ gate: "a", exit: 0, ms: 1, unverified: 0 }, { gate: "b", exit: 1, ms: 2, unverified: 3 }],
    });
    expect(l.runs[0]!.gates).toHaveLength(2);
  });
});

describe("summarize（读表不猜）", () => {
  it("每道门取最近一次的 exit/ms + 样本数", () => {
    const l = ledger(run("t1", "test", 100), run("t2", "test", 40), run("t2", "e2e", 7));
    const rows = summarize(l);
    expect(rows.find((r) => r.gate === "test")).toMatchObject({ lastMs: 40, lastExit: 0, samples: 2 });
    expect(rows.find((r) => r.gate === "e2e")).toMatchObject({ samples: 1 });
  });

  it("maxMs 取样本里的最大值——「哪道门最贵」直接可读", () => {
    const rows = summarize(ledger(run("t1", "test", 800_000), run("t2", "test", 40)));
    expect(rows.find((r) => r.gate === "test")).toMatchObject({ lastMs: 40, maxMs: 800_000 });
  });

  it("红门照样记账（失败也花时间，不能只统计绿的那些）", () => {
    const rows = summarize(ledger(run("t1", "panels-check", 5000, 1)));
    expect(rows.find((r) => r.gate === "panels-check")).toMatchObject({ lastExit: 1, lastMs: 5000 });
  });

  it("未证数按最近一次带出", () => {
    const rows = summarize(ledger(run("t1", "provider:check", 9, 0, 4), run("t2", "provider:check", 9, 0, 1)));
    expect(rows.find((r) => r.gate === "provider:check")).toMatchObject({ lastUnverified: 1 });
  });

  it("空账本 → 零行（不是报错）", () => {
    expect(summarize({ version: 1, runs: [] })).toEqual([]);
  });
});

describe("formatFacts（那条读表命令的输出）", () => {
  it("无账本时明说「还没跑过 gates」，不印空表冒充零成本", () => {
    const out = formatFacts(null);
    expect(out).toContain("还没有账本");
    expect(out).toContain("pnpm gates");
  });

  it("有账本时按最贵在前排，并带上账本时间戳与宿主", () => {
    const out = formatFacts(ledger(run("2026-09-19T00:00:00Z", "test", 54_000), run("2026-09-19T00:00:00Z", "e2e", 2_900)));
    expect(out).toContain("test");
    expect(out.indexOf("test") < out.indexOf("e2e")).toBe(true); // 贵的排前面
    expect(out).toContain("54");
    expect(out).toContain("2026-09-19T00:00:00Z");
    expect(out).toContain("testhost");
  });

  it("输出末尾指向账本路径——文档只准抄这行指针，不准抄值", () => {
    expect(formatFacts(ledger(run("t", "test", 1)))).toContain("docs/facts/gates.json");
  });

  it("--all 展开环形全量：每次整跑一行，含该次门数", () => {
    const out = formatRuns(ledger(run("t1", "test", 100), run("t2", "test", 40)));
    expect(out).toContain("t1");
    expect(out).toContain("t2");
    expect(out.match(/testhost/g)).toHaveLength(2);
  });
});
