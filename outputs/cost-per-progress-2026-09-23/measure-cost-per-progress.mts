/** 每前进一份花多少钱（cost per progress）——本仓自己的录制上的第一次读数。
 *  动机（外部）：SWE-Effi 量到「未解决的尝试平均消耗 >4× 于成功尝试」（expensive failures），
 *  但「最后 N% 轮花掉 X% 成本」这个数**没有任何公开来源**。我们自己的事件流里既有
 *  `deriveProgressBoundaries`（可信前进边界）又有 `usage`（逐请求 token），两只手第一次Meet。
 *
 *  只读物：outputs 下 .events.jsonl。跑法：
 *    TERM=dumb node --import tsx outputs/cost-per-progress-2026-09-23/measure-cost-per-progress.mts
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { replay } from "../../src/events/index";
import { deriveProgressBoundaries } from "../../src/agent/economics";

type Ev = Awaited<ReturnType<typeof replay>>;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".events.jsonl")) out.push(p);
  }
  return out;
}

interface Reading {
  file: string;
  events: number;
  requests: number;
  inTok: number;
  outTok: number;
  cacheRead: number;
  cacheKnown: boolean;
  verified: number;
  userBoundary: number;
  lastProgressEventId: number;
  tokAfterLastProgress: number;
  tokPerVerified: number | null;
  label: "green" | "red" | "unknown";
}

const readings: Reading[] = [];
for (const file of walk("outputs", [])) {
  const events: Ev = await replay(file);
  if (events.length === 0) continue;
  const usages = events.filter((e) => e.type === "usage") as Array<Extract<Ev[number], { type: "usage" }>>;
  if (usages.length === 0) continue;
  const bounds = deriveProgressBoundaries(events);
  const verified = bounds.filter((b) => b.kind === "verified");
  const userBoundary = bounds.filter((b) => b.kind === "user").length;
  const inTok = usages.reduce((n, u) => n + (u.inputTokens ?? 0), 0);
  const outTok = usages.reduce((n, u) => n + (u.outputTokens ?? 0), 0);
  const cacheRead = usages.reduce((n, u) => n + (u.cacheReadInputTokens ?? 0), 0);
  // 「最后一次前进之后又花了多少」：死掉的那段跑的成本，也是 stop-policy 真正要切的对象
  // 用**位置**而不是事件字段：tailStart 是 1-based 事件号，数组下标 0-based ⇒ 比 lastId - 1 大就是前进之后
  const lastId = verified.length > 0 ? verified[verified.length - 1]!.tailStart : 0;
  let tokAfter = 0;
  events.forEach((e, i) => {
    if (e.type === "usage" && i + 1 > lastId) {
      const u = e as Extract<Ev[number], { type: "usage" }>;
      tokAfter += (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
    }
  });
  const verifyResults = events.filter((e) => e.type === "verify_result") as Array<Extract<Ev[number], { type: "verify_result" }>>;
  const lastVerify = [...verifyResults].reverse().find((v) => v.ok !== undefined);
  readings.push({
    file: file.replace("outputs/", ""),
    events: events.length,
    requests: usages.length,
    inTok, outTok, cacheRead,
    cacheKnown: usages.every((u) => u.cacheReadInputTokens !== undefined),
    verified: verified.length,
    userBoundary,
    lastProgressEventId: lastId,
    tokAfterLastProgress: tokAfter,
    tokPerVerified: verified.length > 0 ? Math.round((inTok + outTok) / verified.length) : null,
    label: lastVerify === undefined ? "unknown" : lastVerify.ok === true ? "green" : "red",
  });
}

readings.sort((a, b) => a.file.localeCompare(b.file));
console.log(["跑", "结论", "请求", "输入tok", "输出tok", "缓存读", "verified边界", "user边界", "每前进的tok", "最后一次前进后又花"].join("\t"));
for (const r of readings) {
  console.log([r.file, r.label, String(r.requests), String(r.inTok), String(r.outTok),
    r.cacheKnown ? String(r.cacheRead) : "未上报", String(r.verified), String(r.userBoundary),
    r.tokPerVerified === null ? "—" : String(r.tokPerVerified), String(r.tokAfterLastProgress)].join("\t"));
}

const stat = (xs: number[]) => {
  if (xs.length === 0) return "n/a";
  const s = [...xs].sort((a, b) => a - b);
  return `n=${String(s.length)} min=${String(s[0])} median=${String(s[Math.floor(s.length / 2)])} max=${String(s[s.length - 1])}`;
};
const green = readings.filter((r) => r.label === "green");
const red = readings.filter((r) => r.label === "red");
const gv = green.map((r) => r.tokPerVerified).filter((v): v is number => v !== null);
const rv = red.map((r) => r.tokPerVerified).filter((v): v is number => v !== null);
console.log("\n每前进一份（verified 边界）花的 token：");
console.log("  绿跑 ", stat(gv));
console.log("  红跑 ", stat(rv));
console.log("  比值（红中位 / 绿中位）= ", gv.length && rv.length ? (stat(rv) !== "n/a" ? (rv.sort((a, b) => a - b)[Math.floor(rv.length / 2)]! / gv.sort((a, b) => a - b)[Math.floor(gv.length / 2)]!).toFixed(2) : "n/a") : "n/a",
  "（外部锚点：SWE-Effi 报的是 >4×）");
console.log("最后一次前进之后仍在花的 token：");
console.log("  绿跑 ", stat(green.map((r) => r.tokAfterLastProgress)));
console.log("  红跑 ", stat(red.map((r) => r.tokAfterLastProgress)));
console.log("\n计价面可用性（决定这条能力能不能说「钱」）：");
console.log("  usage 事件带模型字段？", "否（UsageEvent 只有 input/output/cacheRead/cacheWrite/agent_id）⇒ 主会话无法换算美元，只有 worker 侧记了 routeModelId");
console.log("  缓存分列上报率：", readings.filter((r) => r.cacheKnown).length, "/", readings.length, "条录制带 cacheRead");
