/** 定出裁剪样本配方的探针：把「保护区边界 + recentRounds 免剪」逐轮推一遍，
 *  看替换集什么时候开始**变**（只有变的那一轮才改写已发出的历史 = 量得到抖动）。
 *  跑法：TERM=dumb node --import tsx outputs/prefix-churn-2026-09-23/probe-prune-recipe.mts */
import { computePrune } from "../../src/agent/prune";
const cjk = (n: number) => "的".repeat(n);
const ev: never[] = [] as never[];
const anyEv = ev as unknown as Record<string, unknown>[];
for (let r = 0; r < 10; r++) {
  anyEv.push({ type: "user_message", content: "Q" + String(r) });
  anyEv.push({ type: "tool_call", id: "c" + String(r), name: "read_file", args: { path: "f" + String(r) } });
  anyEv.push({ type: "tool_result", callId: "c" + String(r), ok: true, output: cjk(20_000) });
  anyEv.push({ type: "assistant_message", content: "A" + String(r) });
  const o = computePrune({ events: ev });
  console.log("轮", String(r + 1), "why=", o.why, "saved=", String(o.savedTokens), "keys=", [...o.replacements.keys()].join(","));
}
