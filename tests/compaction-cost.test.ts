import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  COMPACT_COST_HEAD_SURVIVAL_HIGH,
  COMPACT_TAIL_FLOOR_TOKENS,
  amortizedCompactionConfig,
  amortizedTailBudget,
  isExpensiveRewrite,
  measureHeadSurvival,
} from "../src/agent/compaction-cost";
import { DEFAULT_COMPACTION_CONFIG } from "../src/agent/compaction";
import { createGlmSessionProvider, sessionToolSpecs } from "../src/agent/glm-session";
import { createMockSummarizer } from "../src/agent/compaction";
import { createEventLog } from "../src/events";
import type { GlmMessage, GlmToolSpec } from "../src/providers/glm";

const CONFIG = { ...DEFAULT_COMPACTION_CONFIG, inputLimit: 12_000, maxOutputReserve: 400, ratio: 0.35, retryBackoffMs: 1 };
const expensive = { share: 0.029, stableChars: 161, prevChars: 5486 };
const cheap = { share: 0.92, stableChars: 5000, prevChars: 5430 };

describe("压缩重写代价摊销：纯策略", () => {
  it("缺省关 ⇒ 返回 undefined（调用方原样用旧配置，逐字节零回归）", () => {
    expect(amortizedCompactionConfig({ enabled: false, headSurvival: expensive, config: CONFIG })).toBeUndefined();
  });

  it("还没有压缩历史（headSurvival=null）⇒ 不动", () => {
    expect(amortizedCompactionConfig({ enabled: true, headSurvival: null, config: CONFIG })).toBeUndefined();
    expect(isExpensiveRewrite(null)).toBe(false);
  });

  it("只有「头部几乎全废」才算贵；阈值本身可判读", () => {
    expect(isExpensiveRewrite(expensive)).toBe(true);
    expect(isExpensiveRewrite(cheap)).toBe(false);
    expect(isExpensiveRewrite({ share: COMPACT_COST_HEAD_SURVIVAL_HIGH, stableChars: 1, prevChars: 7 })).toBe(true);
    expect(isExpensiveRewrite({ share: COMPACT_COST_HEAD_SURVIVAL_HIGH + 0.01, stableChars: 1, prevChars: 7 })).toBe(false);
  });

  it("tail 上下限被钉到同一个值 ⇒ clamp 两种求值顺序都得 next（不靠求值顺序赌）", () => {
    const patch = amortizedCompactionConfig({ enabled: true, headSurvival: expensive, config: CONFIG });
    expect(patch).toBeDefined();
    const available = CONFIG.inputLimit - CONFIG.maxOutputReserve;
    const v = available * CONFIG.tailRatio; // ratio 故意不动 ⇒ v 仍是原值（2,900）
    const lo = patch!.tailMinTokens ?? CONFIG.tailMinTokens;
    const hi = patch!.tailMaxTokens ?? CONFIG.tailMaxTokens;
    const orderA = Math.min(hi, Math.max(lo, v)); // compaction.ts 今天这一只
    const orderB = Math.max(lo, Math.min(v, hi)); // 若有人改写成另一只
    const baseline = Math.min(CONFIG.tailMaxTokens, Math.max(CONFIG.tailMinTokens, v));
    const next = orderA; // 满钉时的有效预算（下面反向锁要拿它比）
    expect(orderA).toBe(orderB);
    expect(orderA).toBeLessThan(baseline);
    expect(orderA).toBeGreaterThanOrEqual(COMPACT_TAIL_FLOOR_TOKENS);
    // 反向锁：只钉一个边界时，两种求值顺序**给出的不是同一个值** ⇒ 结果取决于 clamp 怎么写。
    // （今天这只 clamp 是 min(hi, max(lo, v))，只钉 hi 恰好还能落到 next；换成另一只就回到 2,000。）
    const halfA = Math.min(hi, Math.max(CONFIG.tailMinTokens, v));
    const halfB = Math.max(CONFIG.tailMinTokens, Math.min(v, hi));
    expect(halfA).not.toBe(halfB);
    expect(halfB).toBeGreaterThan(next);
  });

  it("overflow 不摊销：已经装不下了，少压只会立刻再撞一次硬闸", () => {
    expect(amortizedCompactionConfig({ enabled: true, headSurvival: expensive, config: CONFIG, trigger: "overflow" })).toBeUndefined();
    expect(amortizedCompactionConfig({ enabled: true, headSurvival: expensive, config: CONFIG, trigger: "auto" })).toBeDefined();
  });

  it("已在下限就不动——不返回「等效但不同」的配置（守住逐字零回归的语义）", () => {
    const tiny = { ...CONFIG, inputLimit: 4_000, maxOutputReserve: 100, tailMaxTokens: 900, tailMinTokens: 300 };
    expect(amortizedCompactionConfig({ enabled: true, headSurvival: expensive, config: tiny })).toBeUndefined();
    // 且下限永远不得**抬高**已有预算（工作集不被这条策略变大）
    expect(amortizedTailBudget(900)).toBe(900);
    expect(amortizedTailBudget(2_900)).toBe(COMPACT_TAIL_FLOOR_TOKENS);
    expect(amortizedTailBudget(100)).toBe(100);
  });
});

describe("压缩重写代价：测量口径", () => {
  it("纯追加 ⇒ 存活 1.0；中段改一字 ⇒ 断点之后全不存活", () => {
    const prev = JSON.stringify([{ a: 1 }, { b: 2 }]).slice(0, -1);
    const grew = JSON.stringify([{ a: 1 }, { b: 2 }, { c: 3 }]).slice(0, -1);
    expect(measureHeadSurvival(prev, grew).share).toBe(1);
    const rewritten = JSON.stringify([{ a: 1 }, { b: 99 }, { c: 3 }]).slice(0, -1);
    const r = measureHeadSurvival(prev, rewritten);
    expect(r.share).toBeLessThan(1);
    expect(r.stableChars).toBeLessThan(prev.length);
    // 断点 = 被改的那个值的位置：它之前逐字相同，之后全不存活
    expect(r.stableChars).toBe(prev.indexOf("2"));
    expect(measureHeadSurvival("", grew).share).toBe(1); // 空分母不许 NaN
  });
});

/** 端到端：策略接上真装配后，**同一个会话**开关两支的差异必须真的存在。
 *  这条同时守住两处接线：provider 级状态跨请求留得住、以及 `maybeCompact` 真收 config 覆盖。 */
async function runSession(amortize: boolean | undefined, rounds = 8): Promise<{ compactions: number; chars: number }> {
  const dir = mkdtempSync(join(tmpdir(), "compaction-cost-"));
  const path = join(dir, "events.jsonl");
  const log = createEventLog(path);
  const cjk = (n: number) => "的".repeat(n);
  let chars = 0;
  try {
    await log.append({ type: "assistant_message", content: cjk(4_000) });
    await log.append({ type: "user_message", content: "q0" });
    let roundIndex = 0;
    const provider = createGlmSessionProvider(path, {
      map: false,
      workspace: dir,
      system: "固定基础提示".repeat(20),
      compaction: {
        config: { inputLimit: 12_000, maxOutputReserve: 400, ratio: 0.35, retryBackoffMs: 1 },
        summarizer: createMockSummarizer("SUMMARY：前文已压缩为一段。".repeat(12)),
        ...(amortize === undefined ? {} : { amortizeRewriteCost: amortize }),
      },
      requestFace: () => ({ tools: sessionToolSpecs({ mode: "default" }).specs, note: "" }),
      transport: async function* (messages: GlmMessage[], _o: unknown, _specs?: GlmToolSpec[]) {
        chars += JSON.stringify(messages).length;
        yield { type: "assistant_message" as const, content: "r" + String(roundIndex) };
      },
    });
    for (let r = 0; r < rounds; r++) {
      roundIndex = r;
      for await (const _ of provider.stream([])) void _;
      await log.append({ type: "assistant_message", content: cjk(4_000) });
      await log.append({ type: "user_message", content: "after-" + String(r) });
    }
    const txt = readFileSync(path, "utf8");
    return { compactions: (txt.match(/"type":"compaction"/g) ?? []).length, chars };
  } finally {
    await log.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("压缩重写代价摊销：接上真装配", () => {
  afterAll(() => {
    /* 临时目录各自清理 */
  });

  it("不传该字段与显式 false 逐字同行为（缺省关 = 零回归）", async () => {
    const absent = await runSession(undefined, 6);
    const off = await runSession(false, 6);
    expect(off).toEqual(absent);
  }, 60_000);

  it("开着 ⇒ 同一会话里压缩次数不更多、累计重写字符严格更少", async () => {
    const off = await runSession(false);
    const on = await runSession(true);
    expect(off.compactions).toBeGreaterThanOrEqual(2); // 样本必须真能连压两次，否则这条没分辨力
    expect(on.compactions).toBeLessThanOrEqual(off.compactions);
    expect(on.chars).toBeLessThan(off.chars);
  }, 120_000);
});
