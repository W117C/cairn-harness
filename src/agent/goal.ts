// goal 模式的数据面：入参收窄 / 续跑判据 / 每轮提醒块 / 从事件流投影当前目标态。
// 全部纯函数（零 I/O、不 import electron）——「什么时候该停」是唯一会被真模型行为绕过去的那一步，
// 它必须能在没有进程、没有密钥的环境里被逐条判卷；且「价格算不出来」绝不允许被读成「还没花钱」
// （本仓点名的「把不可知记成免费」）。
// 完成判据不自造：直接吃 worker-report 的四态（verified/failed/stale/absent），
// 主会话、worker、级联三处说的必须是同一件事，否则又是一份第二事实源。
import type { AgentEvent, WorkerEvidence } from "../events";
import { clampToTokenBudget } from "./text-budget";
import { hasSessionWrites, workerVerificationEvidence } from "./worker-report";
import { GOAL_TURN_CAP_DEFAULT, GOAL_TURN_CAP_MAX, GOAL_TURN_CAP_MIN, traceGoal } from "./goal-trace";
import type { GoalSpec } from "./goal-trace";

// GoalSpec 与轮次帽的定义挪进了 goal-trace.ts（渲染层要用同一份 reduce 与同一份数，但不能
// import 本文件的 worker-report 链）。在这里再导出一次：既有 importer 与验收脚本零改动。
export type { GoalSpec };
export { GOAL_TURN_CAP_DEFAULT, GOAL_TURN_CAP_MAX, GOAL_TURN_CAP_MIN };

/** 提醒块里目标原文的帽：目标是锚点不是正文，超了就截断（全文在 `goal_set` 事件里，不靠这块携带）。 */
const GOAL_OBJECTIVE_TOKEN_CAP = 400;
/** 整块帽。这块**每轮重送** ⇒ 整会话付 maxTurns 次，所以按"最坏 8 倍"估：帽值本身就是成本上限。 */
export const GOAL_REMINDER_TOKEN_CAP = 700;

export interface GoalParseResult {
  spec: GoalSpec | null;
  errors: string[];
  /** 被钳制/改写的字段逐条点名——静默收下越界输入等于把用户设的预算改掉还不说。 */
  clamped: string[];
}

export interface GoalDecisionInput {
  /** 已完成的 run 轮数（≥1）。 */
  turn: number;
  spec: GoalSpec;
  /** 已花美元；**null = 价格不可知**（不是 0，也不是"没花钱"）。 */
  spentUsd: number | null;
  evidence: WorkerEvidence;
  /** 本会话写过盘吗（write_file/edit_file 成功过）。 */
  wrote: boolean;
  /** **收尾那一轮**是被收走的（输出预算/内容策略），还是模型自己说完了。
   *  缺了它，「被 max_tokens 砍断」与「模型宣称done」在判据里是同一个形状。 */
  truncated: boolean;
}

export type GoalStop =
  | { kind: "done" }
  | { kind: "continue"; note: string }
  | { kind: "stop"; reason: string };

const EVIDENCE_TEXT: Record<WorkerEvidence, string> = {
  verified: "verified（验证通过且没被后续写入作废）",
  stale: "stale（验过之后又写了盘 ⇒ 那份绿证据已作废，要重新 verify 才算）",
  failed: "failed（最近一次验证未通过）",
  absent: "absent（从头到尾没有验证记录）",
};

const usd = (n: number): string => "$" + n.toFixed(4);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 边界一律 fail-visible：形状不对就整条拒收并点名，不给"半个目标"跑起来的机会。 */
export function parseGoalSpec(raw: unknown): GoalParseResult {
  const errors: string[] = [];
  const clamped: string[] = [];
  if (!isRecord(raw)) {
    return { spec: null, errors: ["goal 必须是一个对象（objective / maxTurns / maxUsd）"], clamped };
  }

  const objective = typeof raw.objective === "string" ? raw.objective.trim() : "";
  if (objective === "") errors.push("objective 必须是非空字符串（给了空目标就等于让 agent 自己猜要干什么）");

  let maxTurns = GOAL_TURN_CAP_DEFAULT;
  if (typeof raw.maxTurns === "number" && Number.isFinite(raw.maxTurns)) {
    maxTurns = Math.floor(raw.maxTurns);
    if (maxTurns < GOAL_TURN_CAP_MIN) {
      clamped.push("轮次上限低于 " + String(GOAL_TURN_CAP_MIN) + " ⇒ 钳到 " + String(GOAL_TURN_CAP_MIN) + "（实得 " + String(raw.maxTurns) + "）");
      maxTurns = GOAL_TURN_CAP_MIN;
    } else if (maxTurns > GOAL_TURN_CAP_MAX) {
      clamped.push("轮次上限高于 " + String(GOAL_TURN_CAP_MAX) + " ⇒ 钳到 " + String(GOAL_TURN_CAP_MAX) + "（实得 " + String(raw.maxTurns) + "）");
      maxTurns = GOAL_TURN_CAP_MAX;
    }
  } else if (raw.maxTurns !== undefined) {
    clamped.push("轮次上限不是有限数 ⇒ 用缺省 " + String(GOAL_TURN_CAP_DEFAULT) + "（实得 " + String(raw.maxTurns) + "）");
  }

  let maxUsd = 0;
  if (typeof raw.maxUsd === "number" && Number.isFinite(raw.maxUsd) && raw.maxUsd > 0) {
    maxUsd = raw.maxUsd;
  } else if (raw.maxUsd !== undefined && raw.maxUsd !== 0) {
    clamped.push("美元上限无效（负数 / 非数字 / 非有限）⇒ 按 0 处理，即美元闸关（实得 " + String(raw.maxUsd) + "）");
  }

  if (errors.length > 0) return { spec: null, errors, clamped };
  return { spec: { objective, maxTurns, maxUsd }, errors, clamped };
}

/** 续跑判据。次序即优先级：先认「已达成」，再认「轮次用尽」，再认「钱花到」，最后才问要不要再来一轮。
 *  done 只由绿证据成立——散文自述不算数（顶尖与普通差在「能证明代码真的能跑」）。 */
export function goalStopDecision(input: GoalDecisionInput): GoalStop {
  const { turn, spec, spentUsd, evidence, wrote, truncated } = input;

  if (evidence === "verified") return { kind: "done" };

  if (turn >= spec.maxTurns) {
    return {
      kind: "stop",
      reason:
        "轮次上限 " + String(spec.maxTurns) + " 已用尽而目标未达成（证据 " + evidence + "）⇒ 停在这里，把剩余部分交回用户或换个目标",
    };
  }

  if (spec.maxUsd > 0 && spentUsd !== null && spentUsd >= spec.maxUsd) {
    return {
      kind: "stop",
      reason:
        "美元上限 " + usd(spec.maxUsd) + " 已花到（实花 " + usd(spentUsd) + "，证据 " + evidence + "）⇒ 停，不再自动续跑",
    };
  }

  if (evidence === "absent" && !wrote) {
    // 「没写盘也没证据」有两种完全不同的成因，而旧判据只看形状不看原因：
    // 模型自己说完了 → 续跑确实白花钱；**上一轮被输出预算砍断** → 它根本没说完了，
    // 此时停是把「被打断」擦成「没产出」。轮次闸与美元闸都在本分支之前判过，
    // 所以这一支 continue 不可能造成无界花费。
    if (truncated) {
      return {
        kind: "continue",
        note: "上一轮是被收走的（输出预算/内容策略），不是模型宣布完成 ⇒ 先让它把这一轮说完",
      };
    }
    return {
      kind: "stop",
      reason:
        "没有写过任何文件、也没有任何验证证据 ⇒ 这个目标没有可验证的产出，自动续跑只会白花钱；纯问答/查代码类目标请关掉 goal 模式",
    };
  }

  return { kind: "continue", note: "证据 " + EVIDENCE_TEXT[evidence] + "；" + budgetLine(spec, spentUsd) + "；第 " + String(turn) + "/" + String(spec.maxTurns) + " 轮" };
}

/** 收尾那一轮是不是「没说完就被收走」。
 *  从流尾往回走，第一个**内容事件**决定答案：截断事件本身 → 是；模型正文/工具调用/新一轮提问 → 否。
 *  只认主 loop 的截断（`agent_id` 在场的是 worker 子流，父目标不替 worker 的轮次表态，§4.4.4）。
 *  usage / session_meta / verify_result 等纯计量与纯证据事件继续往回找——自动验证拍就落在截断之后，
 *  把它当「新内容」会让这条判据在最该 continue 的那一格失灵。 */
export function lastTurnWasTruncated(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "turn_truncated") return e.agent_id === undefined;
    if (
      e.type === "assistant_message" || e.type === "assistant_delta" ||
      e.type === "tool_call" || e.type === "user_message"
    ) {
      return false;
    }
  }
  return false;
}

/** 钱的一句话：没设闸 / 价格不可知 / 正常读数，三种分开说。**不可知那一支必须自己出现**，
 *  否则"没提美元"会被读成"还没花"。 */
function budgetLine(spec: GoalSpec, spentUsd: number | null): string {
  if (spec.maxUsd <= 0) return "美元闸未设（只按轮次闸停）";
  if (spentUsd === null) return "花费价格未知 ⇒ 美元闸本次不生效（不把不可知记成免费），只按轮次闸停";
  return "已花 " + usd(spentUsd) + "，美元上限 " + usd(spec.maxUsd);
}

/** 每个续跑轮起点注入的块：目标 + 第几轮 + 上一轮证据态 + 预算口径 + 收束条件。
 *  红字的**逐条输出**不重复携带——#17 的回流通道已经把它送进上下文了，这里再抄一份就是双份付费。 */
export function goalReminder(spec: GoalSpec, turn: number, spentUsd: number | null, evidence: WorkerEvidence): string {
  const body =
    "[goal 续跑 第 " + String(turn) + "/" + String(spec.maxTurns) + " 轮] 目标：" +
    clampToTokenBudget(spec.objective, GOAL_OBJECTIVE_TOKEN_CAP, "目标") +
    "\n上一轮终态：证据 " + EVIDENCE_TEXT[evidence] +
    "（红字逐条已在上一轮上下文里，直接针对它继续，不要重述已经完成的部分）。" +
    "\n预算：" + budgetLine(spec, spentUsd) + "；轮次上限 " + String(spec.maxTurns) + "。" +
    "\n收束条件：只有 verify 通过且之后不再写盘才算完成；认为已达成就调用 verify 拿绿证据再收束。";
  return clampToTokenBudget(body, GOAL_REMINDER_TOKEN_CAP, "goal 提醒");
}

export interface GoalView {
  spec: GoalSpec;
  /** 已发生的 run 轮数（含本轮）：1 + 该 `goal_set` 之后 origin.kind==="goal" 的续跑轮数。
   *  人手发的下一条消息**不**计入——那是人在接管，不是 agent 自己烧的一轮。 */
  turn: number;
  evidence: WorkerEvidence;
  wrote: boolean;
  /** 收尾那一轮是被收走的还是说完了（与 goalStopDecision 的 truncated 同源，同一个函数算）。 */
  truncated: boolean;
  /** 已停下来的原因（`goal_stopped` 原文）；null = 还没停。 */
  stopped: string | null;
  /** **本目标窗口内**（与证据/写盘同一段）的累计 token。美元闸必须量这个，不能量整段会话：
   *  设 $0.5 上限之前会话已经花掉 $0.6 是常事，按全会话算会"第一轮就以已花 $0.6000 停下"，
   *  把用户设的闸变成随机数（审查 C2：闸与其余 goal 量不同轴）。 */
  usage: { inputTokens: number; outputTokens: number };
}

/** 会话当前目标态：一律从事件流重算，live 与 replay 同一份函数（不变量 2：不写第二份会话态）。
 *  证据、「有没有写过盘」与「花了多少 token」只看**最后一条 goal_set 之后**的那段——上一段工作里的
 *  绿证据不能替新目标宣布达成，上一段花的钱也不能替新目标触发美元闸。
 *  设/轮次/停止三项走 goal-trace（渲染层芯片用的是同一个函数）。 */
export function projectGoal(events: AgentEvent[]): GoalView | null {
  const trace = traceGoal(events);
  if (trace === null) return null;
  const window = events.slice(trace.at + 1);
  return {
    spec: trace.spec,
    turn: trace.turn,
    evidence: workerVerificationEvidence(window),
    wrote: hasSessionWrites(window),
    truncated: lastTurnWasTruncated(window),
    stopped: trace.stopped,
    usage: sumWindowUsage(window),
  };
}

/** 窗口累计 token（从 `usage` 事件重算，不留第二份账）。provider 没上报 ⇒ 0/0，
 *  价格闸自然算不出 ⇒ 由 goalStopDecision 明写"美元闸不生效"，而不是当成没花钱。 */
function sumWindowUsage(events: AgentEvent[]): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const e of events) {
    if (e.type === "usage") {
      inputTokens += e.inputTokens;
      outputTokens += e.outputTokens;
    }
  }
  return { inputTokens, outputTokens };
}
