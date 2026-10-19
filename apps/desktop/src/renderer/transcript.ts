// 对话导出（2026-10-18，命令面板「复制整段对话」）：把当前会话的用户/助手正文按序拼成
// Markdown。只收这两类——工具调用参数、思考正文、元信息不进导出（它们是过程，不是对话；
// 需要证据时看交付卡/检查器）。纯函数，无 DOM/IPC，判卷直接钉。
import type { AgentEvent } from "../../../../src/main/ipc-protocol";
import { userVisibleText } from "./projections";

type CopyAttachment = { readonly path: string; readonly kind: "file" | "directory" };

/** 用户消息的复制文本（2026-10-18）：正文 + 附件清单。整段转录与行级「复制这条消息」
 *  共用这一份格式——此前行级复制只抄正文，粘出去就不知道这条消息带过哪些文件。 */
export function userMessageCopy(text: string, attachments?: readonly CopyAttachment[]): string {
  const body = text.trim();
  const files = (attachments ?? []).map((a) => `- ${a.kind === "directory" ? "目录" : "文件"}：\`${a.path}\``);
  return [body, files.length > 0 ? `附件：\n${files.join("\n")}` : ""].filter((p) => p !== "").join("\n\n");
}

/** 空标题回落到「未命名会话」（导出面不摆空 `#`）。 */
export function transcriptMarkdown(events: readonly AgentEvent[], title: string): string {
  const head = title.trim() === "" ? "未命名会话" : title.trim();
  const parts: string[] = [`# ${head}`];
  for (const e of events) {
    if (e.type === "user_message") {
      const block = userMessageCopy(userVisibleText(e), e.attachments);
      if (block !== "") parts.push(`## 你\n\n${block}`);
    } else if (e.type === "assistant_message") {
      const body = e.content.trim();
      if (body !== "") parts.push(`## Cairn\n\n${body}`);
    }
  }
  // 每段之间空一行；末尾补一个换行（粘贴进 Markdown 编辑器不会与下一段粘连）。
  return parts.join("\n\n") + "\n";
}

/** 文件名清洗（导出用）：去掉路径分隔符与 macOS/Windows 非法字符，压掉连续空白，截断 80 字符。
 *  空标题 → 会话。扩展名由调用方/主进程负责（这里只给 stem）。 */
export function transcriptFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `${cleaned === "" ? "会话" : cleaned}.md`;
}
