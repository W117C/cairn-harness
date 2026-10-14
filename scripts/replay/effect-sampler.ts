// 复跑面 · 登记项 `replay:effect-sampler`
// （判卷读数：`docs/m5-acceptance.md` 那两格「未测量」第一次有会印数的尺）
//
// 为什么立这一条：`src/agent/acceptance-sampler.ts` 两个采样器（review-fail 自愈率、生产 spawn
// 路由决策覆盖率）写完之后**零消费者**——本仓点过名的「只有验收脚本在调」那一族。没有这一条面，
// m5-acceptance 那两格永远停在非真非假的第三态：判卷绿证的是规则与边界，不是发生率。
//
// 三条口径纪律：
//  ⑴ **不另造谓词**：分子分母只问 `reviewFailHealRate` / `routingDecisionCoverage`（含主会话与
//     worker 子流的分界、`agent_id` join 键）。本文件自己只做**池化**与三态裁决。
//  ⑵ 池化不取均值：按文件取均值会让一个 1 轮的文件与一个 17 轮的文件等权，读数随文件粒度漂移。
//  ⑶ 三态守卫同 join-lapse / run-scorecard：零语料、两格都没分母 ⇒ 红着退出说「不可测」，
//     不许读成「自愈率 0%」「覆盖率 0%」。
// 附带一格**分辨力**读数：整批语料里 `routing_decision` 事件条数。覆盖率 0% 同时兼容
// 「路由没上场」与「上场了但漏记」，两者的修法完全不同，所以分母侧必须把这个数一起印出来。
//
// 复跑：TERM=dumb node --import tsx scripts/replay/effect-sampler.ts
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";
import {
  formatRate,
  reviewFailHealRate,
  routingDecisionCoverage,
  type RateSample,
} from "../../src/agent/acceptance-sampler";
import type { AgentEvent } from "../../src/events";

/** M5 效果目标（`docs/m5-acceptance.md`）：review-fail 自愈率至少 50%。 */
export const HEAL_TARGET_PCT = 50;

/** 池化读数：两格各一个 RateSample，加一份取料账与两个分辨力计数。 */
export interface FaceTotals {
  files: number;
  heal: RateSample;
  cover: RateSample;
  /** 整批语料里 `routing_decision` 事件条数（判「没上场」与「漏记」）。 */
  decisions: number;
  /** 分母侧：真派出的 worker 数（`agent_spawned`）。 */
  spawns: number;
}

const pool = (hits: number, total: number): RateSample => ({ hits, total, unmeasurable: total === 0 });

export function scanSamplerFace(files: readonly (readonly unknown[])[]): FaceTotals {
  let healHits = 0;
  let healTotal = 0;
  let coverHits = 0;
  let coverTotal = 0;
  let decisions = 0;
  let spawns = 0;
  for (const lines of files) {
    const events = lines as readonly AgentEvent[];
    const h = reviewFailHealRate(events);
    healHits += h.hits;
    healTotal += h.total;
    const c = routingDecisionCoverage(events);
    coverHits += c.hits;
    coverTotal += c.total;
    for (const e of events) {
      if (e.type === "routing_decision") decisions += 1;
      else if (e.type === "agent_spawned") spawns += 1;
    }
  }
  return { files: files.length, heal: pool(healHits, healTotal), cover: pool(coverHits, coverTotal), decisions, spawns };
}

/** 自愈率那一行的人读面（含 M5 目标对照；不可测时不印百分比）。 */
export function healLine(t: FaceTotals): string {
  if (t.heal.unmeasurable) {
    return formatRate("review-fail 自愈率", t.heal) + "（语料里没有「红过又转绿」的轮 ⇒ 没有分母）";
  }
  const pct = Math.round((t.heal.hits / t.heal.total) * 100);
  const met = pct >= HEAL_TARGET_PCT;
  return formatRate("review-fail 自愈率", t.heal) +
    `（M5 目标 ≥${String(HEAL_TARGET_PCT)}% ⇒ ${met ? "达成" : "未达成"}）`;
}

/** 覆盖率那一行的人读面。分母在而决策事件 0 条 ⇒ 明说这是「路由没上场」，不是「漏记」。 */
export function coverLine(t: FaceTotals): string {
  if (t.cover.unmeasurable) {
    return formatRate("生产 spawn 路由决策覆盖率", t.cover) + "（语料里一个 worker 都没派过 ⇒ 没有分母）";
  }
  const caveat = t.decisions === 0
    ? " ⚠️ 整批语料 routing_decision 事件 0 条 ⇒ 读数是「路由没上场」，不是「上场了却漏记」——修法不同"
    : "";
  return formatRate("生产 spawn 路由决策覆盖率", t.cover) + caveat;
}

/** 三态裁决（与 cascade-traffic 同一形状：先判「有没有尺」，再判「该不该动」）。 */
export function samplerVerdict(t: FaceTotals, hasCorpus: boolean): string {
  if (!hasCorpus) {
    return "不可测：没有任何语料可读（见 zeroCorpusProblem）——会话流不在 git 里，" +
      "这是「没有尺」，不是「两格都读到了零」；换到有历史会话的树上再跑。";
  }
  if (t.heal.unmeasurable && t.cover.unmeasurable) {
    return "不可测：" + String(t.files) + " 个文件里既没有「红过又转绿」的轮、也没有一次 spawn ⇒ " +
      // 这句话自己不许带上 `0%` 那个字形：一出现，「不可测」就被读成、也被下游扫成一个零读数。
      "两格都没有分母，读数不是零；反转条件 = 出现带 verify_result 红拍或 spawn_agent 的语料。";
  }
  const parts: string[] = [];
  parts.push(t.heal.unmeasurable ? "自愈率不可测" : "自愈率 " + healLine(t).match(/= (\d+)%/)?.[1] + "%");
  parts.push(t.cover.unmeasurable ? "覆盖率不可测" : "覆盖率 " + coverLine(t).match(/= (\d+)%/)?.[1] + "%");
  return "该量：" + parts.join(" · ") + "（分母各来自出过红灯的轮与真派出的 worker，池化不取均值）";
}

/** 每次跑都注入的自检（规则 74）：合成对照必须被抓、也必须不被抓，否则「0%」兼容「尺是瞎的」。 */
export function selfCheck(): string[] {
  const problems: string[] = [];
  const user = { type: "user_message", content: "改" };
  const verify = (ok: boolean, agentId?: string): unknown => ({
    type: "verify_result", callId: "v" + String(Math.random()), ok, attempt: 1, maxAttempts: 3, results: [],
    ...(agentId !== undefined ? { agent_id: agentId } : {}),
  });
  const spawned = (agentId: string): unknown => ({ type: "agent_spawned", agent_id: agentId, mode: "read", task: "t" });
  const decision = (agentId: string): unknown => ({
    type: "routing_decision", agent_id: agentId, candidates: [], picked: "m1", reason: "tier-default",
  });

  // ① 自愈率：红后转绿算自愈，红到底不算
  const heal = scanSamplerFace([[user, verify(false), verify(true)], [user, verify(false)]]);
  if (heal.heal.hits !== 1 || heal.heal.total !== 2) {
    problems.push(`① 自愈率分子分母没分对（应 1/2，实读 ${String(heal.heal.hits)}/${String(heal.heal.total)}）`);
  }
  // ② 反控：没红过的轮不进分母（否则读数随任务难度漂移）
  const noRed = scanSamplerFace([[user, verify(true)]]);
  if (!noRed.heal.unmeasurable) problems.push("② 没红过的轮被算进了分母 ⇒ 读数会随任务难度漂移");
  // ③ 覆盖率：决策事件按 agent_id 与 spawn 对上
  const cover = scanSamplerFace([[spawned("w1"), decision("w1"), spawned("w2")]]);
  if (cover.cover.hits !== 1 || cover.cover.total !== 2) {
    problems.push(`③ 覆盖率没按 agent_id 对上（应 1/2，实读 ${String(cover.cover.hits)}/${String(cover.cover.total)}）`);
  }
  // ④ 同一 id 多条决策只算一次（分母是 spawn 数，不是事件数）
  const dup = scanSamplerFace([[decision("w1"), decision("w1"), spawned("w1")]]);
  if (dup.cover.hits !== 1 || dup.cover.total !== 1) problems.push("④ 重复决策被数成了多分（分母应是 spawn 数）");
  // ⑤ worker 子流的灯不算主会话的自愈（与 cost-per-progress 同口径）
  const worker = scanSamplerFace([[user, verify(false), verify(true, "w9")]]);
  if (worker.heal.hits !== 0 || worker.heal.total !== 1) {
    problems.push(`⑤ worker 子流的绿灯被算成了主会话自愈（应 0/1，实读 ${String(worker.heal.hits)}/${String(worker.heal.total)}）`);
  }
  // ⑥ ⑦ 裁决两条反向分支各走一次（规则 144）
  if (!samplerVerdict(heal, false).startsWith("不可测")) problems.push("⑥ 没有语料却印成「该量」⇒ 把没有尺读成了读数");
  if (!samplerVerdict({ files: 3, heal: pool(0, 0), cover: pool(0, 0), decisions: 0, spawns: 0 }, true).startsWith("不可测")) {
    problems.push("⑦ 两格都没分母却印成「该量」⇒ 把不可测折成了 0%");
  }
  const measurable = samplerVerdict(heal, true);
  if (!measurable.startsWith("该量")) problems.push("⑧ 有分母却判「不可测」⇒ 尺把有流量的语料判成没尺");
  if (!measurable.includes("池化不取均值")) problems.push("⑨ 裁决没交代池化口径（按文件取均值会让读数随文件粒度漂移）");
  // ⑩ 分辨力格：分母在而决策 0 条时必须明说「没上场」而不是「漏记」
  const off = samplerVerdict({ files: 2, heal: heal.heal, cover: pool(0, 4), decisions: 0, spawns: 4 }, true);
  if (!coverLine({ files: 2, heal: heal.heal, cover: pool(0, 4), decisions: 0, spawns: 4 }).includes("路由没上场")) {
    problems.push("⑩ 覆盖率 0% 没说清是「路由没上场」还是「漏记」⇒ 两种成因的修法被混成一个读数");
  }
  if (!off.startsWith("该量")) problems.push("⑪ 一格可测就整体可测，不该被另一格拖成不可测");
  return problems;
}

function main(): void {
  const problems = selfCheck();
  if (problems.length > 0) {
    console.error("❌ effect-sampler 自检未过（尺自己不可信，读数不作数）：\n  " + problems.join("\n  "));
    process.exitCode = 1;
    return;
  }
  const scan = scanCorpus();
  const empty = zeroCorpusProblem(scan);
  const t = scanSamplerFace(scan.files.map((f) => readJsonl(f)));
  console.log("自检（合成对照：该抓的抓到 / 反控不被抓 / 裁决两条反向分支各走一次）= 全过 · 取料 = " +
    String(scan.files.length) + " 个 jsonl" + (empty === null ? "" : "（⚠️ " + empty + "）"));
  console.log("  " + healLine(t));
  console.log("  " + coverLine(t));
  console.log(samplerVerdict(t, empty === null));
  if (empty !== null) process.exitCode = 1;
}

// 守卫两侧同形：本仓路径含空格，`file://` + argv[1] 会被百分号编码成 `%20` ⇒ 永不相等、
// 脚本变成「exit 0 且什么都不印」（2026-09-24 在同一目录里实踩过，见 cascade-traffic.ts 的注释）。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
