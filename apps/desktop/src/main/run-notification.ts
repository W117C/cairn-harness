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
}

export interface RunNotificationCopy {
  title: string;
  body: string;
}

export function shouldNotifyRunSettled(input: RunNotificationInput): boolean {
  return input.supported && !input.anyWindowFocused && input.sessionId.trim() !== "";
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
