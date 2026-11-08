// 闭环 v2 集成判卷：runEvolution 的账本落账（与 evolution.json 同锁同批）、复发升级措辞、
// 装配缝偏置读料口（evolutionRoutingBias）。旧的装配面行为（evolution.json 逐字兼容）由
// tests/evolution.test.ts 原有判卷守着，这里只钉 v2 新增的三格。
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLedger, evolutionLedgerPathFor, loadLedger, projectLedger } from "../src/agent/evolution/ledger.js";
import { evolutionRoutingBias, loadEvolution, persistEvolution, runEvolution } from "../src/agent/evolution/index.js";
import type { AgentEvent } from "../src/events/index.js";

const ev = (e: Record<string, unknown>): AgentEvent => e as unknown as AgentEvent;

const failingRun: AgentEvent[] = [
  ev({ type: "user_message", content: "任务" }),
  ev({ type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, cause: "code", results: [] }),
  ev({ type: "verify_result", callId: "v2", ok: false, attempt: 2, maxAttempts: 3, cause: "code", results: [] }),
  ev({ type: "verify_result", callId: "v3", ok: false, attempt: 3, maxAttempts: 3, cause: "code", results: [] }),
];

describe("runEvolution v2：账本与 evolution.json 同批落盘", () => {
  it("收束一次 ⇒ 两份都在：evolution.json（装配面）+ ledger（run+emit 行）", async () => {
    const root = await mkdtemp(join(tmpdir(), "evo-v2-"));
    try {
      const res = await runEvolution(failingRun, root, "sess-1");
      expect(res.persistedTo).not.toBeNull();
      expect(existsSync(evolutionLedgerPathFor(root))).toBe(true);
      const loaded = await loadLedger(root);
      expect(loaded.events.length).toBe(2); // run + 1 条 emit（verify-escalate）
      expect(loaded.events[0]!.type).toBe("run");
      const runLine = loaded.events[0] as { session?: string; verifyOutcome: string; patches: number };
      expect(runLine.session).toBe("sess-1");
      expect(runLine.verifyOutcome).toBe("red");
      expect(loaded.events[1]!.type).toBe("emit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("跨轮复发两次后，第三轮补丁措辞带「（第 2 次复发）」且账面 emit 记的就是这句", async () => {
    const root = await mkdtemp(join(tmpdir(), "evo-v2-"));
    try {
      const patch = { kind: "verify-escalate" as const, cause: "code", times: 3, note: "旧方子。" };
      // 盘上摆好两件事：上一轮记录（这条补丁还在挂账）+ 账本里两拍 recurred（连击 2）。
      await persistEvolution(root, [patch], "sess-prev");
      await appendLedger(root, [
        { v: 1, type: "emit", ts: 1, key: "verify-escalate:code", kind: "verify-escalate", note: "旧方子。" },
        { v: 1, type: "observe", ts: 1, key: "verify-escalate:code", status: "recurred", observed: "又犯" },
        { v: 1, type: "emit", ts: 2, key: "verify-escalate:code", kind: "verify-escalate", note: "旧方子。" },
        { v: 1, type: "observe", ts: 2, key: "verify-escalate:code", status: "recurred", observed: "又犯" },
      ]);
      const projection = projectLedger((await loadLedger(root)).events);
      expect(projection.stats["verify-escalate:code"]!.recurrenceStreak).toBe(2);

      const res = await runEvolution(failingRun, root, "sess-now");
      expect(res.patches.length).toBe(1);
      expect(res.patches[0]!.note.startsWith("（第 2 次复发）")).toBe(true);
      // 装配面（evolution.json）与账面（ledger 的 emit）记的是同一句——审计不打架。
      const record = await loadEvolution(root);
      expect(record!.patches[0]!.note).toBe(res.patches[0]!.note);
      const ledger = await loadLedger(root);
      // 取**最后一条** emit：账本里有测试预摆的历史行，本轮新落的那条在队尾。
      const emits = ledger.events.filter((e): boolean => e.type === "emit");
      const emitLine = emits[emits.length - 1] as { note: string };
      expect(emitLine.note).toBe(res.patches[0]!.note);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("反思位注入：合法产出改写 note、拒因出声；未注入 = 纯规则", async () => {
    const root = await mkdtemp(join(tmpdir(), "evo-v2-"));
    try {
      const reflect = async (): Promise<unknown> => ({
        proposals: [
          { kind: "verify-escalate", note: "反思措辞：先复跑测试定位。", evidenceCallIds: ["v1"] },
          { kind: "goal-reconfirm", note: "没证据的", evidenceCallIds: [] },
        ],
      });
      const res = await runEvolution(failingRun, root, "s", { reflect });
      const escalated = res.patches.find((p): boolean => p.kind === "verify-escalate");
      expect(escalated!.note).toContain("反思措辞");
      expect(res.reflectRefusals.some((r): boolean => r.includes("goal-reconfirm"))).toBe(true);
      // 无反思注入时同一份事件跑出来的 note 就是规则句（回退面）。
      const root2 = await mkdtemp(join(tmpdir(), "evo-v2-"));
      try {
        const plain = await runEvolution(failingRun, root2, "s");
        expect(plain.patches[0]!.note).not.toContain("反思措辞");
      } finally {
        await rm(root2, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("evolutionRoutingBias（批次 A4 读料口）", () => {
  it("有建议的记录 ⇒ 两个决策字段程序可读；无记录 ⇒ 全 null", async () => {
    const root = await mkdtemp(join(tmpdir(), "evo-v2-"));
    try {
      expect(await evolutionRoutingBias(root)).toEqual({ preferredTier: null, contextAction: null });
      await persistEvolution(root, [], "s", {
        advice: { preferredTier: "cheap", contextAction: "compress-early", reasons: ["每次 verified 前进平均花 99000 token（偏高线 40000）"] },
      });
      expect(await evolutionRoutingBias(root)).toEqual({ preferredTier: "cheap", contextAction: "compress-early" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("读料与渲染同源：promptNote 与 bias 读的是同一份记录", async () => {
    const root = await mkdtemp(join(tmpdir(), "evo-v2-"));
    try {
      await persistEvolution(root, [], "s", {
        advice: { preferredTier: "cheap", contextAction: "compress-early", reasons: ["贵"] },
      });
      const { evolutionPromptNote } = await import("../src/agent/evolution/index.js");
      const note = await evolutionPromptNote(root);
      const bias = await evolutionRoutingBias(root);
      expect(note).toContain("降一档到便宜模型");
      expect(bias.preferredTier).toBe("cheap");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
