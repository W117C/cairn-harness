// 完成通知的纯决策/文案（2026-10-25）：把「发不发、发什么、点了落到哪」从 Electron Notification
// 壳里拆出来，单测可钉；main/index.ts 只留 Notification 构造与点击转发。
// 不 import Electron：本文件可以在普通 vitest 里跑。
export interface RunNotificationInput {
  sessionId: string;
  workspace?: string;
  /** 本轮用户任务原文（取首行做通知正文，比裸会话 id 可读）。 */
  message?: string;
  ok: boolean;
  error?: string;
  /** Notification.isSupported() 的读数（由 Electron 壳传入）。 */
  supported: boolean;
  /** 当前是否有任意应用窗口聚焦（有 = 用户就在跟前，不发）。 */
  anyWindowFocused: boolean;
  /** 用户是否要完成通知（settings.notifyOnComplete；缺省开）。 */
  enabled: boolean;
  /** 这一轮的会话就是当前窗口正在看的那个（同 workspace + 同 session）。 */
  viewingTarget: boolean;
}

export interface RunNotificationCopy {
  title: string;
  body: string;
}

/** 「你不在看那个会话」：窗口失焦 ⇒ 一定不在看；窗口聚焦 ⇒ 只有正看着它才免打扰。
 *  旧口径只判「窗口整体失焦」，于是聚焦着看 A、B 跑完不发——与蓝本 §3.3「不在看那个会话」不符。 */
export function shouldNotifyRunSettled(input: RunNotificationInput): boolean {
  if (!input.enabled || !input.supported || input.sessionId.trim() === "") return false;
  return !input.anyWindowFocused || !input.viewingTarget;
}

/** 窗口可见会话快照（主进程按窗口记录；focused 在通知决策时取实时值）。 */
export interface ViewingSnapshot {
  windowId: number;
  focused: boolean;
  sessionId: string | null;
  workspace: string | null;
}

/** 视图是否正看着目标会话：同 session；目标未带 workspace 或视图 workspace 未知时只按 session 比对。 */
function viewingMatches(
  viewSessionId: string | null,
  viewWorkspace: string | null,
  sessionId: string,
  workspace?: string,
): boolean {
  const sid = sessionId.trim();
  if (sid === "" || viewSessionId !== sid) return false;
  const ws = workspace?.trim() ?? "";
  return ws === "" || viewWorkspace === null || viewWorkspace === ws;
}

/** 「有焦点窗口正在看目标会话」：后台弹窗/后台主窗不算；没有 workspace 的旧上报
 *  只按 session 比对（与旧口径「宁可少发」一致，不把可见会话误判成不在看）。 */
export function focusedWindowViewing(
  snapshots: readonly ViewingSnapshot[],
  sessionId: string,
  workspace?: string,
): boolean {
  return snapshots.some((v) => v.focused && viewingMatches(v.sessionId, v.workspace, sessionId, workspace));
}

/** 通知点击时的窗口候选（alive/focused 由主进程实时取）。 */
export interface NotificationWindowCandidate {
  windowId: number;
  alive: boolean;
  focused: boolean;
  sessionId: string | null;
  workspace: string | null;
}

/** 通知点击落点：已在看目标会话的窗口优先（其中焦点者再优先，弹窗与主窗同等），
 *  否则主窗，再否则任一存活窗口；没有存活窗口返回 null。
 *  「看得到目标」的窗口被点到前台后无需再转发开会话——它已经显示着。 */
export function notificationClickWindow(
  candidates: readonly NotificationWindowCandidate[],
  target: { sessionId: string; workspace?: string },
  mainWindowId: number | null,
): number | null {
  const viewing = (v: NotificationWindowCandidate): boolean =>
    v.alive && viewingMatches(v.sessionId, v.workspace, target.sessionId, target.workspace);
  const picked =
    candidates.find((v) => viewing(v) && v.focused)
    ?? candidates.find(viewing)
    ?? candidates.find((v) => v.alive && mainWindowId !== null && v.windowId === mainWindowId)
    ?? candidates.find((v) => v.alive);
  return picked === undefined ? null : picked.windowId;
}

/** 通知正文的单行摘要：首行、空白折叠、最多 80 码点（不切代理对）。 */
export function notificationPreview(message: string | undefined): string {
  const firstLine = (message ?? "").split(/\r?\n/u)[0] ?? "";
  const oneLine = firstLine.replace(/\s+/gu, " ").trim();
  const chars = [...oneLine];
  return chars.length > 80 ? `${chars.slice(0, 80).join("")}…` : oneLine;
}

export function runNotificationCopy(input: Pick<RunNotificationInput, "message" | "ok" | "error">): RunNotificationCopy {
  const preview = notificationPreview(input.message);
  const title = input.ok ? "Cairn · 会话完成" : "Cairn · 会话未完成";
  if (input.ok) {
    return { title, body: preview === "" ? "本轮已收束。" : `会话「${preview}」本轮已收束。` };
  }
  const trimmedError = input.error?.trim();
  const reason = trimmedError === undefined || trimmedError === "" ? "未知原因" : trimmedError;
  return {
    title,
    body: preview === "" ? `本轮未完成：${reason}` : `会话「${preview}」本轮未完成：${reason}`,
  };
}

/** 点击后转发给 renderer 的最小载荷；workspace 帮助跨项目同名 id 精确寻址。 */
export function runNotificationTarget(input: Pick<RunNotificationInput, "sessionId" | "workspace">): { sessionId: string; workspace?: string } {
  const workspace = input.workspace?.trim() ?? "";
  return workspace === "" ? { sessionId: input.sessionId } : { sessionId: input.sessionId, workspace };
}
