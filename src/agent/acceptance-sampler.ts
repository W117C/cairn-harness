// M5 效果面采样器（`docs/m5-acceptance.md` 三条至今只能写「未测量」的格）。
// 为什么单独立一个文件：那三格（review-fail 自愈率、生产 `routing_decision` 覆盖率、真模型暗卷）
// 之所以永远是第三态，是因为**没有会印数的东西**——判卷绿证的是规则与边界，不是发生率。
// 本文件给前两格各一把尺：吃事件流，出**分子/分母**；取不到分母就落「不可测」，
// 绝不折成 0 或 100%（与 cost-per-progress 同源纪律）。
// 纯函数 + 只读事件流 ⇒ 可离线判卷、可喂合成语料，不需要凭据也不需要真模型。
import type { AgentEvent } from "../events";

/** 一格的读数：分母为 0 ⇒ 不可测（与「0%」是两种事实，不许合并）。 */
export interface RateSample {
  /** 分子（命中的样本数）。 */
  hits: number;
  /** 分母（可判的样本数）。 */
  total: number;
  /** 分母为 0 ⇒ true ⇒ 这一格没有读数，不许被读成 0%。 */
  unmeasurable: boolean;
}

function rate(hits: number, total: number): RateSample {
  return { hits, total, unmeasurable: total === 0 };
}

/** 主会话面（worker 子流不计，与 projectStream/cost-per-progress 同口径）。 */
function isWorkerSubflow(e: AgentEvent): boolean {
  if (e.type === "agent_spawned") return false; // 父流事实（「派出了哪个 worker」）
  return typeof (e as { agent_id?: unknown }).agent_id === "string";
}

/**
 * review-fail 自愈率：一轮里「验证红 → 之后又验过且转绿」的比例。
 * 判据刻意只看 `verify_result` 的 ok 序列，不读散文（模型说"修好了"不算数）：
 * 有红灯且后续出现绿灯 = 自愈；有红灯而无后续绿灯 = 未自愈；无红灯 = 不进分母。
 * 为什么分母是「出过红灯的轮」而不是「所有轮」：没红过的轮不存在自愈与否这个问题，
 * 把它们塞进分母会让读数随「任务有多难」漂移，而不是反映「修得有多好」。
 */
export function reviewFailHealRate(events: readonly AgentEvent[]): RateSample {
  const main = events.filter((e) => !isWorkerSubflow(e));
  let roundHadRed = false;
  let healed = false;
  let hits = 0;
  let total = 0;
  const closeRound = (): void => {
    if (!roundHadRed) return;
    total += 1;
    if (healed) hits += 1;
  };
  for (const e of main) {
    if (e.type === "user_message") {
      closeRound();
      roundHadRed = false;
      healed = false;
      continue;
    }
    if (e.type !== "verify_result") continue;
    // 红灯先记下；之后同轮出现绿灯 ⇒ 这一轮自愈（灯序只认机器判据）。
    if (!roundHadRed && e.ok === false) {
      roundHadRed = true;
      continue;
    }
    if (roundHadRed && e.ok === true) healed = true;
  }
  closeRound();
  return rate(hits, total);
}

/**
 * 生产 spawn 的路由决策覆盖率：`agent_spawned` 里**配得上**一条 `routing_decision` 的比例。
 *  join 键是 `agent_id`，不是 spawn 事件上的一个字段：决策是**独立事件**（`orchestrator.ts:776`
 * 先 emit `routing_decision`、再 emit `agent_spawned`，两者一对一），`AgentSpawnedEvent` 上
 * 根本没有 `routing_decision` 这个字段。按字段读 ⇒ 真实会话里恒为 0，读出来的是形状错不是真读数。
 * 分母只数**真派出的 worker**（agent_spawned 是唯一权威的 spawn 事实面）。
 */
export function routingDecisionCoverage(events: readonly AgentEvent[]): RateSample {
  const spawns = events.filter((e) => e.type === "agent_spawned");
  if (spawns.length === 0) return rate(0, 0);
  // 决策事件按 worker 归因（`agent_id`）。一个 id 多条只算一次：判的是「这一派出活有没有决策面」。
  const decided = new Set<string>();
  for (const e of events) {
    if (e.type !== "routing_decision") continue;
    const id = (e as { agent_id?: unknown }).agent_id;
    if (typeof id === "string") decided.add(id);
  }
  const withDecision = spawns.filter((e) => decided.has(e.agent_id));
  return rate(withDecision.length, spawns.length);
}

/** 一格的人读面（门与台账共用一个写法，不在两处各拼一次字符串）。 */
export function formatRate(label: string, s: RateSample, unit = "%"): string {
  // 不可测这句话自己不许带上 `0${unit}` 那个字形：它一出现，「不可测」就被读成、也被下游扫成
  // 一个零读数（本仓三态纪律：读到 0 与没有尺是两件事）。所以这里只说「没有尺、读数不是零」。
  if (s.unmeasurable) return `${label}：不可测（分母 0 ⇒ 这一格没有尺，读数不是零）`;
  const pct = Math.round((s.hits / s.total) * 100);
  return `${label}：${String(s.hits)}/${String(s.total)} = ${String(pct)}${unit}`;
}
