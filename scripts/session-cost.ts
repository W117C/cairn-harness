// 一场会话的**代价读数**（2026-09-30 P2 立项）。
//
// 为什么不能直接比 inputTokens：缓存命中的那些 token 与全价的 token **不是一个价**。
// 只报 input 总量会把「缓存命中率变高」读成「变贵了」——这正是 P2 第一次改完时的读数形状：
//   distill 轮 cacheRead 从 181 涨到 8,010（命中率 2.2% → 98.8%），
//   可 input 总量也从 4,417 涨到 8,116。看总量像是变贵，看有效价才是变便宜。
//
// 所以这把尺把一场会话折成**有效输入 token**：
//   有效输入 = Σ(input - cacheRead) + Σ(cacheRead) × 折扣
// 折扣缺省 0.1（缓存命中按 1 折计）。这是个**约定**，不是厂商精算——
// 各家折扣不同（OpenAI 约 0.5、Anthropic 约 0.1、OpenRouter 透传上游）。
// 它的用途是**同一模型、同一会话形状下的横向比较**，不用于跨厂商报价。
//
// 用法：
//   node --import tsx scripts/session-cost.ts <会话.jsonl> [--cache-discount=0.1]
//   node --import tsx scripts/session-cost.ts --json <会话.jsonl>
import { readFileSync } from "node:fs";

const DEFAULT_CACHE_DISCOUNT = 0.1;

export interface RoundCost {
  /** 第几轮（1-based）。 */
  n: number;
  input: number;
  cacheRead: number;
  output: number;
  /** 有效输入 = 未命中部分全价 + 命中部分按折扣。 */
  effectiveInput: number;
  /** 这一轮是不是会话末沉淀轮（最后一轮且带 usage）。 */
  kind: "main" | "distill";
}

export interface SessionCost {
  rounds: RoundCost[];
  input: number;
  cacheRead: number;
  output: number;
  effectiveInput: number;
  cacheHitRate: number;
  discount: number;
}

interface UsageEvent {
  type?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
}

/** 从会话 JSONL 原文算代价（纯函数，可单测）。 */
export function sessionCostFromJsonl(text: string, discount = DEFAULT_CACHE_DISCOUNT): SessionCost {
  const events = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as UsageEvent);
  const usages = events.filter((e) => e.type === "usage");
  const rounds: RoundCost[] = usages.map((u, i) => {
    const input = u.inputTokens ?? 0;
    const cacheRead = u.cacheReadInputTokens ?? 0;
    return {
      n: i + 1,
      input,
      cacheRead,
      output: u.outputTokens ?? 0,
      effectiveInput: (input - cacheRead) + cacheRead * discount,
      // 最后一轮 usage = 会话末沉淀轮（它在主循环收束之后独立跑一次）。
      kind: i === usages.length - 1 ? "distill" : "main",
    };
  });
  const sum = (pick: (r: RoundCost) => number): number => rounds.reduce((a, r) => a + pick(r), 0);
  const input = sum((r) => r.input);
  const cacheRead = sum((r) => r.cacheRead);
  return {
    rounds,
    input,
    cacheRead,
    output: sum((r) => r.output),
    effectiveInput: sum((r) => r.effectiveInput),
    cacheHitRate: input === 0 ? 0 : cacheRead / input,
    discount,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const discountArg = argv.find((a) => a.startsWith("--cache-discount="));
  const discount = discountArg === undefined ? DEFAULT_CACHE_DISCOUNT : Number(discountArg.split("=")[1]);
  const file = argv.find((a) => !a.startsWith("--"));
  if (file === undefined) {
    console.error("用法：node --import tsx scripts/session-cost.ts <会话.jsonl> [--cache-discount=0.1] [--json]");
    process.exitCode = 2;
    return;
  }
  const cost = sessionCostFromJsonl(readFileSync(file, "utf8"), discount);
  if (asJson) {
    process.stdout.write(JSON.stringify(cost, null, 2) + "\n");
    return;
  }
  console.log("== 会话代价 ==");
  console.log("  文件：" + file);
  console.log("  轮数：" + String(cost.rounds.length) + "（主 " + String(cost.rounds.length - 1) + " + 沉淀 1）");
  console.log("  原始 input：" + String(cost.input) + " tok｜缓存命中 " + String(cost.cacheRead)
    + "（" + (100 * cost.cacheHitRate).toFixed(1) + "%）");
  console.log("  有效 input：" + cost.effectiveInput.toFixed(0) + " tok（命中按 " + String(discount) + " 折）");
  console.log("  output：" + String(cost.output) + " tok");
  console.log("");
  console.log("  逐轮（有效 = 未命中全价 + 命中折价）：");
  for (const r of cost.rounds) {
    console.log("    r" + String(r.n).padStart(2) + " " + r.kind.padEnd(7)
      + " in=" + String(r.input).padStart(6)
      + " cache=" + String(r.cacheRead).padStart(6)
      + " eff=" + r.effectiveInput.toFixed(0).padStart(6)
      + " out=" + String(r.output).padStart(5));
  }
  const d = cost.rounds.find((r) => r.kind === "distill");
  if (d !== undefined) {
    console.log("");
    console.log("  沉淀轮占整场有效代价：" + (100 * d.effectiveInput / Math.max(cost.effectiveInput, 1)).toFixed(1) + "%");
  }
}

// 只有直接执行时才跑 main（可被 import 单测）。
if (process.argv[1] !== undefined && process.argv[1].endsWith("session-cost.ts")) main();
