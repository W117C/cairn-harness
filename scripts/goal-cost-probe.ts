// 一次性探针（不入库）：goal 模式**自身**的边际上下文成本读数。
// 只量"因为开了 goal 才多出来的那部分"：续跑轮每轮重送的提醒块（用户消息位）。
// 不含各轮本来就要付的会话上下文——那是任何多轮对话的既有成本，记进 goal 的账就是虚报。
import { GOAL_REMINDER_TOKEN_CAP, GOAL_TURN_CAP_DEFAULT, GOAL_TURN_CAP_MAX, goalReminder } from "../src/agent/goal";
import { estimateTextTokens } from "../src/agent/text-budget";
import { costUsd, DEFAULT_PRICE_TABLE } from "../src/routing/pricing";
import type { WorkerEvidence } from "../src/events";

const OBJ_SHORT = "把 tests/ 里失败的用例修到全绿，并保证 pnpm typecheck 通过";
const OBJ_LONG = "目标".repeat(3000); // 病态长目标：看帽是否真生效

const CONTINUING: WorkerEvidence[] = ["stale", "failed", "absent"];

function row(name: string, text: string, turns: number): void {
  const one = estimateTextTokens(text);
  // 第 k 轮的块会在 k..N 每轮输入里再出现一次 ⇒ 计费次数是三角级数，不是"块数"。
  const total = one * ((turns * (turns + 1)) / 2);
  const usd = (id: string): string =>
    "$" +
    costUsd(id, { inputTokens: total, outputTokens: 0 }).toFixed(6) +
    (DEFAULT_PRICE_TABLE[id]?.calibrated === true ? "" : "（占位价）");
  console.log(
    [
      name,
      "字符=" + String(text.length),
      "token/轮=" + String(one),
      "帽=" + String(GOAL_REMINDER_TOKEN_CAP) + (one <= GOAL_REMINDER_TOKEN_CAP ? " 未触帽" : " **超帽**"),
      "轮数=" + String(turns),
      "整目标付进输入的 token=" + String(total) + "（块数 " + String(turns) + " × 每块 " + String(one) + "，含重送）",
      "glm-standard " + usd("glm-standard"),
      "openai-standard " + usd("openai-standard"),
      "anthropic-strong " + usd("anthropic-strong"),
    ].join(" | "),
  );
}

console.log("== goal 模式边际成本（提醒块；每续跑轮重送一次）==");
for (const ev of CONTINUING) {
  row("缺省目标 " + GOAL_TURN_CAP_DEFAULT + " 轮 / 证据 " + ev, goalReminder({ objective: OBJ_SHORT, maxTurns: GOAL_TURN_CAP_DEFAULT, maxUsd: 2 }, 2, 0.4, ev), GOAL_TURN_CAP_DEFAULT - 1);
}
row(
  "美元闸价格不可知那支（文案最长）",
  goalReminder({ objective: OBJ_SHORT, maxTurns: GOAL_TURN_CAP_DEFAULT, maxUsd: 2 }, 2, null, "failed"),
  GOAL_TURN_CAP_DEFAULT - 1,
);
row(
  "病态长目标（帽是否生效）",
  goalReminder({ objective: OBJ_LONG, maxTurns: GOAL_TURN_CAP_MAX, maxUsd: 5 }, 2, 1.2, "stale"),
  GOAL_TURN_CAP_MAX - 1,
);
console.log(
  "对照：人手打的一句「继续」≈ " + String(estimateTextTokens("继续")) + " token/轮；" +
    "提醒块的**结构上界**（含重送）= 帽 700 × " + String(GOAL_TURN_CAP_MAX - 1) + " 块的三角级数 " +
    String(((GOAL_TURN_CAP_MAX - 1) * GOAL_TURN_CAP_MAX) / 2) + " = " +
    String(700 * ((GOAL_TURN_CAP_MAX - 1) * GOAL_TURN_CAP_MAX) / 2) + " token",
);

