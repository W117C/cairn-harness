// M8：`m0 --fork` / `m0 --replay` 的纯逻辑层（CLI 只做接线与交互）。
// 为什么单独成文件：分叉点算术与回放渲染都要能被离线判卷逐条钉（cli.ts 是入口壳，进去就起全流程）。
// 事件溯源本身早就支持分叉（`forkSession`，gym 在跑）——缺的只是**入口**；这一层提供入口要的三件事：
//   ① 轮次 → 分叉事件点（`--from <轮次>` 的口径）；② 新会话命名；③ 决策链的可读渲染（含 gate 判定）。
//
// `--from <轮次>` 的口径（help 与判卷都按这句）：**保留前 N 轮（含）**，新任务作为第 N+1 轮
// 跑在新会话上。「轮」以 `user_message` 为界——那是"一次用户交付"的唯一边界事件。
import { parsePatch } from "../tools/patch-parse";
import { isWorkerDiffReceipt, patchSectionOf } from "./diff-review";
import type { AgentEvent } from "../events";

/** 首行摘要（长文本压一行；live 渲染与 replay 共用同一份）。 */
export function firstLine(text: string, max = 100): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

/** args 摘要：write_file 那种大 payload 只报键名与路径，不把正文刷到终端。 */
export function argsDigest(args: Record<string, unknown>): string {
  const path = args.path ?? args.file_path;
  if (typeof path === "string") return path;
  if (typeof args.command === "string") return firstLine(args.command);
  const keys = Object.keys(args);
  return keys.length === 0 ? "" : `（${keys.join(", ")}）`;
}

export interface ForkPoint {
  /** forkSession 的 eventId：保留到第几条事件（1-based 计数）。 */
  lastIncluded: number;
  /** 这条会话一共几轮（判据行与报错都要用）。 */
  totalRounds: number;
}

/** 轮次 → 分叉事件点。`round` = 保留前几轮 ⇒ 最后保留的事件 = 第 round+1 条的 user_message 前一条；
 *  已是最后一轮则保留全量（分叉 = 换个会话 id 续跑，语义仍然成立）。 */
export function forkPointOf(events: readonly AgentEvent[], round: number): ForkPoint | { error: string } {
  const userAt: number[] = []; // user_message 的 1-based 事件序号
  events.forEach((e, i) => {
    if (e.type === "user_message") userAt.push(i + 1);
  });
  const totalRounds = userAt.length;
  if (!Number.isInteger(round) || round < 1) return { error: `--from 要正整数轮次，收到：${String(round)}` };
  if (totalRounds === 0) return { error: "这条会话还没有任何一轮（0 条 user_message），没有可分叉的点" };
  if (round > totalRounds) return { error: `--from ${String(round)} 超出会话轮数（该会话共 ${String(totalRounds)} 轮）` };
  const lastIncluded = round < totalRounds ? userAt[round]! - 1 : events.length;
  return { lastIncluded, totalRounds };
}

/** 分叉出的新会话名。合法性（字符/长度）由调用方用 `isValidSessionName` 复核——这里只拼名字。 */
export function forkSessionName(sessionId: string, round: number): string {
  return sessionId + "-f" + String(round);
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + "…" : s);

/** worker diff 的摘要行（整块 patch 不进 replay——文件数/增删行才是"改了什么"的形状；
 *  `parsePatch` 解析不了时退回首行，不编数字）。 */
function diffSummary(output: string): string {
  try {
    const files = parsePatch(patchSectionOf(output));
    let add = 0;
    let rem = 0;
    let hunks = 0;
    for (const f of files) for (const h of f.hunks) {
      hunks += 1;
      for (const l of h.lines) {
        if (l.mark === "+") add += 1;
        else if (l.mark === "-") rem += 1;
      }
    }
    return `worker diff：${String(files.length)} 文件 / ${String(hunks)} hunk / +${String(add)} −${String(rem)} 行`;
  } catch {
    return "worker diff（解析失败，原文见 JSONL）：" + firstLine(output, 120);
  }
}

/** 决策链回放（`m0 --replay`）。一行一事件，序号与 `forkSession` 的 eventId 同源（`#N` = 第 N 条）——
 *  看准了"当时为什么这么干"就能直接拿这个号去 `--fork --from`。
 *  未知类型不静默丢：打 `（<type>：本行不做摘要）`，回放里看不见 = 没有。 */
export function formatReplay(events: readonly AgentEvent[]): string {
  // assistant_delta 只对真 provider 存在（流式），按其 callId 合并后**在首次出现处**打一行。
  const deltaText = new Map<string, string>();
  for (const e of events) {
    if (e.type === "assistant_delta") deltaText.set(e.callId, (deltaText.get(e.callId) ?? "") + e.text);
  }
  const deltaShown = new Set<string>();
  const out: string[] = [];
  events.forEach((e, i) => {
    let detail: string | undefined;
    switch (e.type) {
      case "session_meta":
        detail = e.branch_of === undefined ? "（会话头）" : "分叉自 " + clip(e.branch_of, 140);
        break;
      case "user_message":
        detail = "任务：" + clip(firstLine(e.content, 200), 200);
        break;
      case "assistant_message":
        detail = clip(e.content, 200) === "" ? "(空)" : clip(e.content, 200);
        break;
      case "assistant_delta":
        if (deltaShown.has(e.callId)) return;
        deltaShown.add(e.callId);
        detail = clip(deltaText.get(e.callId) ?? "", 200);
        break;
      case "tool_call":
        detail = `${e.name} ${clip(argsDigest(e.args), 140)}`;
        break;
      case "tool_result": {
        if (isWorkerDiffReceipt(e)) {
          detail = (e.ok ? "✓ " : "✗ ") + diffSummary(e.output);
          break;
        }
        const gate = e.gate === undefined ? "" : ` [${e.gate.verdict}·${e.gate.layer}]`;
        detail = `${e.ok ? "✓" : "✗"}${gate} ${clip(firstLine(e.output, 160), 160)}`;
        break;
      }
      case "verify_result":
        detail =
          `验证 ${e.ok ? "通过" : "失败"}（第 ${String(e.attempt)}/${String(e.maxAttempts)} 拍）` +
          (e.cause === undefined ? "" : " cause=" + e.cause);
        break;
      case "approval_requested":
        detail = `${e.id} ${e.agent_id} 请求 ${e.tool}${e.risk === undefined ? "" : "（风险 " + e.risk + "）"}`;
        break;
      case "approval_resolved":
        detail = `${e.id} ${e.agent_id} → ${e.decision}${e.scope === undefined ? "" : "（" + e.scope + "）"}`;
        break;
      case "agent_spawned":
        detail = `${e.agent_id}（${e.mode}·${e.permission_mode}）${clip(firstLine(e.task, 120), 120)}`;
        break;
      case "agent_status":
        detail = `${e.agent_id} → ${e.status}${e.reason === undefined ? "" : "（" + clip(e.reason, 80) + "）"}`;
        break;
      case "agent_message":
        detail = `[${e.agent_id}/${e.kind}] ${clip(firstLine(e.text, 160), 160)}`;
        break;
      case "agent_result":
        detail =
          `${e.agent_id} ${e.status}` +
          (e.artifacts.files_changed === undefined ? "" : ` 改 ${String(e.artifacts.files_changed.length)} 文件`) +
          (e.artifacts.verified === undefined ? "" : ` 证据 ${e.artifacts.verified}`) +
          "：" + clip(firstLine(e.summary, 120), 120);
        break;
      case "goal_set":
        detail = `目标：${clip(firstLine(e.objective, 120), 120)}（≤${String(e.max_turns)} 轮）`;
        break;
      case "goal_stopped":
        detail = `第 ${String(e.turn)} 轮停止（证据 ${e.evidence}）：${clip(e.reason, 140)}`;
        break;
      case "plan_proposed":
        detail = `${e.callId} 方案：${clip(firstLine((e.plan as { goal?: string }).goal ?? "", 140), 140)}`;
        break;
      case "plan_approved":
        detail = `${e.callId} → ${e.approved ? "批准" : "拒绝"}`;
        break;
      case "clarify_requested":
        detail = `${e.callId} 提问 ${String(e.questions.length)} 条：${clip(e.questions[0]?.question ?? "", 120)}`;
        break;
      case "card_action":
        detail = `${e.card_type}/${e.action}${e.target_agent_id === undefined ? "" : " @ " + e.target_agent_id}`;
        break;
      case "impact_report":
        detail = `${e.file} 波及 ${String(e.up.length)} 处`;
        break;
      case "security_report":
        detail = "安全报告：" + JSON.stringify((e as { bySeverity?: Record<string, number> }).bySeverity ?? {});
        break;
      case "error":
        detail = `第 ${String(e.step ?? 0)} 轮：${clip(e.message, 160)}`;
        break;
      case "turn_truncated":
        detail = "本轮输出被截断";
        break;
      case "usage":
        detail = `tokens in=${String(e.inputTokens)} out=${String(e.outputTokens)}`;
        break;
      default:
        detail = "（" + (e as { type: string }).type + "：本行不做摘要）";
        break;
    }
    out.push(`#${String(i + 1)} ${e.type} ${detail ?? ""}`.trimEnd());
  });
  return out.join("\n");
}
