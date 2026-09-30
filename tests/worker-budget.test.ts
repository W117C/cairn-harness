// worker 上下文预算认模型（主会话 d64084e 的同一口径补到 worker 面）：
// orchestrator 里 worker 压缩配置一直吃 DEFAULT_COMPACTION_CONFIG 的硬编码 128k，
// 而路由分支手里本来就有 spec（ctxWindow）——256k/1M 档白提前压缩（多烧一次摘要 + 丢冷细节），
// 反向（窗口小于基线）则会把超窗请求发给远端吃 400。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventLog } from "../src/events";
import { DEFAULT_COMPACTION_CONFIG } from "../src/agent/compaction";
import {
  Orchestrator,
  WORKER_COMPACTION_CONFIG,
  scriptedWorkerModel,
  workerBudgetConfig,
  type SpawnArgs,
} from "../src/agent/orchestrator";
import type { ModelOutput } from "../src/providers";

const BASELINE = { ...DEFAULT_COMPACTION_CONFIG, ...WORKER_COMPACTION_CONFIG };

describe("workerBudgetConfig（预算基线认模型窗口）", () => {
  it("窗口未知 ⇒ 逐字退回旧行为（注入模型 / 未开路由 / 恢复的旧 handle）", () => {
    expect(workerBudgetConfig({})).toEqual(BASELINE);
    expect(workerBudgetConfig({ modelCtxWindow: undefined })).toEqual(BASELINE);
  });

  it("窗口比基线大 ⇒ 抬到真实窗口（256k 档不再按 128k 提前压缩），worker 专属 ratio 保留", () => {
    const c = workerBudgetConfig({ modelCtxWindow: 256_000 });
    expect(c.inputLimit).toBe(256_000);
    expect(c.ratio).toBe(0.95);
  });

  it("调用方显式覆盖更小 ⇒ 覆盖赢（验收注入小 inputLimit 的通道不受影响）", () => {
    const c = workerBudgetConfig({ modelCtxWindow: 256_000 }, { inputLimit: 4_000 });
    expect(c.inputLimit).toBe(4_000);
  });

  it("显式覆盖超出模型窗口 ⇒ 本地钳到窗口（超窗必吃远端 400，fail-closed 不留给远端）", () => {
    const c = workerBudgetConfig({ modelCtxWindow: 128_000 }, { inputLimit: 900_000 });
    expect(c.inputLimit).toBe(128_000);
  });

  it("窗口退化值（NaN / 负数 / 0）⇒ 不采信，仍按基线", () => {
    for (const w of [Number.NaN, -1, 0]) {
      expect(workerBudgetConfig({ modelCtxWindow: w })).toEqual(BASELINE);
    }
  });

  /* 旧口径把「窗口 == 输出预留」也当退化值（那时预留恒 8192，窗口 8192 没有可用输入）。
     2026-09-30 起预留跟着窗口缩（见 compaction.ts 的 scaledOutputReserve），
     所以 8192 是一个**合法的小窗口**：inputLimit 认它、预留缩到 2048、可用输入 6144。
     它仍装不下工具面+系统提示词的 ~3500 固定开销之外太多东西，但那是可用性问题，
     不是「不采信窗口」——两者不能混（混了就会拿 128k 的预算去打一个 8k 的模型）。 */
  it("窗口 == 旧预留值 ⇒ 现在是合法小窗口：认窗口、预留按它缩", () => {
    const c = workerBudgetConfig({ modelCtxWindow: BASELINE.maxOutputReserve });
    expect(c.inputLimit).toBe(BASELINE.maxOutputReserve);
    expect(c.maxOutputReserve).toBeLessThan(BASELINE.maxOutputReserve);
    expect(c.inputLimit - c.maxOutputReserve).toBeGreaterThan(0);
  });
});

// ---- 接线：路由分支把 spec 的窗口带进 handle；注入模型分支不带 ----

let work: string;
let logPath: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "worker-budget-"));
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
  vi.unstubAllGlobals();
});

function makeOrch(over: { routing?: boolean; model?: (a: SpawnArgs) => ReturnType<typeof scriptedWorkerModel> }) {
  return new Orchestrator({
    logPath,
    workspace: work,
    parentMode: "default",
    emit: async (e) => {
      await createEventLog(logPath).append(e);
    },
    ...(over.routing ? { routing: true } : {}),
    ...(over.model ? { modelFor: over.model } : {}),
  });
}

function firstHandle(orch: Orchestrator): { modelCtxWindow?: number } | undefined {
  const map = (orch as unknown as { workers: Map<string, { modelCtxWindow?: number }> }).workers;
  return [...map.values()][0];
}

const DONE: ModelOutput[] = [{ type: "assistant_message", content: "## 结论\n- 完成" }];

describe("spawn 处的窗口接线", () => {
  it("路由选中 strong 档 ⇒ handle 带该档 ctxWindow（无需 registry 二次查名）", async () => {
    const key = process.env.M0_API_KEY;
    process.env.M0_API_KEY = "test-key";
    try {
      // 真凭据缺失时 toWorkerModel 会发起真实请求：这里把出网掐成即时失败，零外呼
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new TypeError("stubbed: no egress in tests");
      }));
      const orch = makeOrch({ routing: true });
      const r = await orch.spawn({ mode: "read", task: "定档任务", model: "glm-strong" }, { callId: "s1" });
      expect(r.ok).toBe(true);
      expect(firstHandle(orch)?.modelCtxWindow).toBe(256_000);
      await orch.cancelAll();
    } finally {
      if (key === undefined) delete process.env.M0_API_KEY;
      else process.env.M0_API_KEY = key;
    }
  }, 15_000);

  it("注入模型（modelFor）⇒ handle 不带窗口，worker 预算逐字旧行为", async () => {
    const orch = makeOrch({ routing: true, model: () => scriptedWorkerModel(DONE) });
    const r = await orch.spawn({ mode: "read", task: "注入模型任务" }, { callId: "s1" });
    expect(r.ok).toBe(true);
    expect(firstHandle(orch)?.modelCtxWindow).toBeUndefined();
    expect(workerBudgetConfig(firstHandle(orch) ?? {})).toEqual(BASELINE);
    await orch.waitAll(5_000);
  }, 15_000);
});
