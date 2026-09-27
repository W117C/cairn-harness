// 读数探针（钱轴缺的那一列到底缺在哪）：`usage` 事件里没有 model ⇒ `run-scorecard` 的钱轴报"不可测"。
// 但本仓的事件流里**另有带档位 id / 模型名的行**：`routing_decision.picked`（唯一 emit 点在 worker 派活）、
// `agent_spawned.model`。价表的键正是档位 id，而 `priceForModel(name, pickedId)` 的第二参就是为它留的。
// 所以"要先补写侧归因"这个结论之前，先量**能不能不写新东西、只把已有的两支事件 join 起来**
// （规则：判"没法测"前先查通道缺不缺表达法；读数一片 0 先怀疑 join 键）。
//
// 只读；不改任何东西。刻意不 import run-scorecard 本体（那条面有自己的顶层动作），只复用取料层 corpus.ts。
import { readFileSync } from "node:fs";
import { scanCorpus, corpusRoots } from "../../scripts/replay/corpus";
import { DEFAULT_MODEL_TABLE } from "../../src/providers/registry";
import { priceForModel, spentUsdFor } from "../../src/agent/orchestrator-join";

interface Ev {
  type?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  model?: string;
  picked?: string;
  agent_id?: string;
}

const files = scanCorpus().files;
const roots = corpusRoots();

let usageEvents = 0;
let usageWithModel = 0;
let cacheChunkReported = 0;
/** 每种事件类型里带 model / picked 字段的行数 —— 「流里到底有没有那一列」的原始证据。 */
const modelBearing = new Map<string, number>();
/** 按 agent_id 归因（缺省 = 主会话那一格 ""）：最近一次看到的档位/模型名。 */
let joinable = 0;
let joinableAndPriced = 0;
let tokensPriced = 0;
let usdPriced = 0;
const joinableByKind = new Map<string, number>();
const perRoot = new Map<string, { files: number; usage: number; joinable: number; priced: number }>();

for (const path of files) {
  const root = roots.find((r) => path.startsWith(r)) ?? "(其他)";
  const acc = perRoot.get(root) ?? { files: 0, usage: 0, joinable: 0, priced: 0 };
  acc.files += 1;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  const lastModel = new Map<string, { name: string; via: string }>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    let e: Ev;
    try {
      e = JSON.parse(t) as Ev;
    } catch {
      continue;
    }
    const type = typeof e.type === "string" ? e.type : "(无 type)";
    if (typeof e.model === "string" && e.model !== "") {
      modelBearing.set(`${type}.model`, (modelBearing.get(`${type}.model`) ?? 0) + 1);
      lastModel.set(e.agent_id ?? "", { name: e.model, via: `${type}.model` });
    }
    if (typeof e.picked === "string" && e.picked !== "") {
      modelBearing.set(`${type}.picked`, (modelBearing.get(`${type}.picked`) ?? 0) + 1);
      lastModel.set(e.agent_id ?? "", { name: e.picked, via: `${type}.picked` });
    }
    if (type !== "usage") continue;
    usageEvents += 1;
    acc.usage += 1;
    if (typeof e.model === "string" && e.model !== "") usageWithModel += 1;
    if (typeof e.cacheReadInputTokens === "number" || typeof e.cacheWriteInputTokens === "number") cacheChunkReported += 1;
    const seen = lastModel.get(e.agent_id ?? "");
    if (seen === undefined) continue;
    joinable += 1;
    acc.joinable += 1;
    joinableByKind.set(seen.via, (joinableByKind.get(seen.via) ?? 0) + 1);
    const inTok = Math.max(0, e.inputTokens ?? 0);
    const outTok = Math.max(0, e.outputTokens ?? 0);
    const spend = spentUsdFor(priceForModel(seen.name, seen.name), { inputTokens: inTok, outputTokens: outTok });
    if (spend !== null) {
      joinableAndPriced += 1;
      acc.priced += 1;
      tokensPriced += inTok + outTok;
      usdPriced += spend.usd;
    }
  }
  perRoot.set(root, acc);
}

console.log(`语料：${String(files.length)} 个 .jsonl，根 = ${roots.join(" | ")}`);
console.log(`usage 事件 ${String(usageEvents)} 条 —— 自己带 model ${String(usageWithModel)}，带缓存分块 ${String(cacheChunkReported)}`);
console.log(`join 得到档位的 ${String(joinable)} 条（占 ${String(Math.round((joinable / Math.max(1, usageEvents)) * 100))}%），其中 picked 命中价表可折美元的 ${String(joinableAndPriced)} 条`);
console.log(`可折部分：token ${String(tokensPriced)} · 表价 $${usdPriced.toFixed(4)}`);
console.log(`join 键来源：${[...joinableByKind.entries()].map(([k, v]) => `${k}×${String(v)}`).join(", ") || "(无)"}`);
console.log(`全语料带模型名的字段（类型.字段 → 行数）：${[...modelBearing.entries()].map(([k, v]) => `${k}×${String(v)}`).join(", ") || "(无)"}`);
console.log(`档位表 id（${String(DEFAULT_MODEL_TABLE.length)} 个）：${DEFAULT_MODEL_TABLE.map((s) => s.id).join(", ")}`);
for (const [root, a] of perRoot) {
  console.log(`  根 ${root}：文件 ${String(a.files)} · usage ${String(a.usage)} · joinable ${String(a.joinable)} · 可折价 ${String(a.priced)}`);
}
