// 思考档位的「会话内选择」与「首条消息前选择」的唯一映射处（2026-10-22）。
//
// 病灶（真机复现）：空屏（activeId === null）上的模型芯片照样显示「· 思考 关」并可拨，
// 但 WorkbenchView 的 onThinkingChange 在 activeId === null 时直接 return —— 拨完既没有状态、
// 也没有任何提示；用户以为「这一轮用强思考」，第一条消息实际按 off 发出去。控件看着是活的，
// 数据没动，这是本仓最忌的「装饰性按钮」。
//
// 修法：空屏上的选择落进 `pendingThinking`（下一条新会话的起点），建会话时由
// `seedNewSessionThinking` 写进按会话的 map；界面读 `composerThinking`（显式选择 > 缺省 off）。
// 三条规则都是纯函数，判卷不依赖 React 渲染。
import type { ThinkingEffort } from "../../../../../src/providers/capabilities";

const LEVELS: readonly ThinkingEffort[] = ["off", "low", "medium", "high"];

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** 芯片显示哪一档：空屏读「下一条新会话」的待用值；会话内读该会话的显式选择。 */
export function composerThinking(
  activeId: string | null,
  pending: ThinkingEffort,
  bySession: ReadonlyMap<string, string>,
): ThinkingEffort {
  if (activeId === null) return pending;
  const stored = bySession.get(activeId);
  return isThinkingEffort(stored) ? stored : "off";
}

export type ThinkingChange =
  | { kind: "pending"; level: ThinkingEffort }
  | { kind: "session"; sessionId: string; level: ThinkingEffort };

/** 拨一下之后该改哪一格：空屏改 pending，会话内改该会话。非法档位 ⇒ null（不猜、不夹紧）。 */
export function thinkingChangeTarget(activeId: string | null, level: unknown): ThinkingChange | null {
  if (!isThinkingEffort(level)) return null;
  return activeId === null
    ? { kind: "pending", level }
    : { kind: "session", sessionId: activeId, level };
}

/** 新会话落成时把待用档位写进按会话的 map。off 不写（缺省本来就不发参数，少一条脏数据）。 */
export function seedNewSessionThinking(
  sessionId: string,
  pending: ThinkingEffort,
  bySession: Map<string, string>,
): void {
  if (pending === "off") return;
  bySession.set(sessionId, pending);
}
