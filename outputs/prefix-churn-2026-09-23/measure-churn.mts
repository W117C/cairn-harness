/**
 * 前缀抖动读数（cache churn）：从**真实录制**的 loop-eval 事件流里取每轮 usage，
 * 把「本轮未命中缓存的 token」拆成两部分——
 *   ① 本轮新增（≈ 上一轮之后新写的 assistant/tool 内容）
 *   ② 抖动（本该命中前缀却被重写的部分）
 * 判据不是「uncached 有多少」，而是 **uncached 是否远超新增**：前缀真稳定时二者应接近。
 *
 * 为什么拿录制数据而不是靶场：靶场三条 case 实测全是 `requests=1`（上日 BLOCKED 裁决 3 的原话），
 * 而 loop-eval 的 75+ 条 usage 是真连记录 ⇒ 唯一现成的多轮 cache 证据。
 *
 * 跑法：TERM=dumb node --import tsx outputs/prefix-churn-2026-09-23/measure-churn.mts
 * 读物，不属判卷文件。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Turn {
  input: number;
  read: number;
}
interface Run {
  id: string;
  turns: Turn[];
}

function collect(): Run[] {
  const runs: Run[] = [];
  for (const dir of readdirSync("outputs").filter((d) => d.startsWith("loop-eval-"))) {
    for (const f of readdirSync(join("outputs", dir)).filter((x) => x.endsWith(".events.jsonl"))) {
      const turns: Turn[] = [];
      for (const line of readFileSync(join("outputs", dir, f), "utf8").split("\n")) {
        if (!line.includes('"usage"')) continue;
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue; // 逐行容错（本仓 replay 纪律）
        }
        if (e.type !== "usage") continue;
        const input = Number(e.inputTokens ?? 0);
        const read = Number(e.cacheReadInputTokens ?? 0);
        if (input > 0) turns.push({ input, read });
      }
      if (turns.length > 1) runs.push({ id: `${dir}/${f.replace(".events.jsonl", "")}`, turns });
    }
  }
  return runs;
}

const runs = collect();
const pct = (a: number, b: number) => (b === 0 ? "n/a" : ((a / b) * 100).toFixed(1) + "%");

console.log(`录制里多轮（>1 请求）的 run：${String(runs.length)} 个，共 ${String(runs.reduce((n, r) => n + r.turns.length, 0))} 条 usage`);
console.log("");
console.log("逐轮（uncached = input - cacheRead；Δuncached = 本轮 uncached 与上轮 uncached 之差）");
let coldReadSum = 0,
  warmReadSum = 0,
  warmInputSum = 0,
  warmCount = 0;
const perTurnGrowth: number[] = [];
for (const r of runs.slice(0, 6)) {
  console.log(`  ${r.id}`);
  r.turns.forEach((t, i) => {
    const uncached = t.input - t.read;
    const prev = i > 0 ? r.turns[i - 1]!.input - r.turns[i - 1]!.read : null;
    const grewBy = prev === null ? null : uncached - prev;
    if (i === 0) coldReadSum += t.read;
    else {
      warmReadSum += t.read;
      warmInputSum += t.input;
      warmCount++;
      if (grewBy !== null) perTurnGrowth.push(grewBy);
    }
    console.log(
      `    轮${String(i + 1).padStart(2)} input=${String(t.input).padStart(6)} cacheRead=${String(t.read).padStart(6)} ` +
        `uncached=${String(uncached).padStart(6)} (${pct(uncached, t.input)})` +
        (grewBy === null ? "" : ` Δuncached=${String(grewBy).padStart(5)}`),
    );
  });
}

const sorted = [...perTurnGrowth].sort((a, b) => a - b);
const q = (p: number) => (sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!);
console.log("");
console.log("汇总（只算第 2 轮起，第 1 轮本来就没缓存可命中）");
console.log(`  暖轮 cacheRead 份额：${pct(warmReadSum, warmInputSum)}（read=${String(warmReadSum)} / input=${String(warmInputSum)}，${String(warmCount)} 轮）`);
console.log(`  Δuncached 分位：p50=${String(q(0.5))} p90=${String(q(0.9))} max=${String(sorted[sorted.length - 1] ?? "n/a")}（单位 token）`);
console.log("  判读口径：Δuncached ≈ 本轮新增内容 ⇒ 前缀稳定；Δuncached 远大于新增 ⇒ 有抖动（前缀被重写）。");
console.log(`  含 cacheRead 的暖轮比例：${pct(perTurnGrowth.length, warmCount)}（0 ⇒ 这批记录根本没吃到缓存，抖动无从谈起）`);
