// 对话导出（2026-10-18，命令面板「复制整段对话」）：把当前会话的用户/助手正文按序拼成
// Markdown。只收这两类——工具调用参数、思考正文、元信息不进导出（它们是过程，不是对话；
// 需要证据时看交付卡/检查器）。纯函数，无 DOM/IPC，判卷直接钉。
import type { AgentEvent } from "../../../../src/main/ipc-protocol";
import { isWorkerSubflowEvent, userVisibleText } from "./projections";

type CopyAttachment = { readonly path: string; readonly kind: "file" | "directory" };

/** 用户消息的复制文本（2026-10-18）：正文 + 附件清单。整段转录与行级「复制这条消息」
 *  共用这一份格式——此前行级复制只抄正文，粘出去就不知道这条消息带过哪些文件。 */
export function userMessageCopy(text: string, attachments?: readonly CopyAttachment[]): string {
  const body = text.trim();
  const files = (attachments ?? []).map((a) => `- ${a.kind === "directory" ? "目录" : "文件"}：\`${a.path}\``);
  return [body, files.length > 0 ? `附件：\n${files.join("\n")}` : ""].filter((p) => p !== "").join("\n\n");
}

/** 空标题回落到「未命名会话」（导出面不摆空 `#`）。
 *
 *  为什么必须收 `assistant_delta`：真实 provider（openai.ts / anthropic.ts）**一轮只发 delta**，
 *  `assistant_message` 终稿是 mock/demo 通道才有的东西（projections.ts 的 projectStream 早就按
 *  这个口径分桶）。只认终稿的旧实现在每一个真会话上都会导出一份**只有用户消息**的对话——
 *  助手的回答整段消失。判据因此走 delta 分桶：同 callId 的 delta 按序拼成一段，
 *  落定点与 projectStream 同口径（轮界 = 下一条 user_message，停转 = 事件流结束）。
 *
 *  思考正文**不进导出**（thinking_delta 是模型自言自语，与导出面"只收对话正文"的既定口径一致）。 */
export function transcriptMarkdown(events: readonly AgentEvent[], title: string): string {
  const head = title.trim() === "" ? "未命名会话" : title.trim();
  const parts: string[] = [`# ${head}`];
  // 未结的 delta 桶：callId → 累计正文。落定时才决定要不要成段（空文本 = 只想过没说，不出段）。
  let pending = new Map<string, string>();
  const flush = (): void => {
    for (const text of pending.values()) {
      const body = text.trim();
      if (body !== "") parts.push(`## Cairn\n\n${body}`);
    }
    pending = new Map();
  };
  for (const e of events) {
    if (isWorkerSubflowEvent(e)) continue;
    switch (e.type) {
      case "user_message":
        flush(); // 轮界：上一轮没被终稿收走的桶在此落定
        {
          const block = userMessageCopy(userVisibleText(e), e.attachments);
          if (block !== "") parts.push(`## 你\n\n${block}`);
        }
        break;
      case "assistant_message":
        // 终稿到达即取代所有未结桶（它无 callId，无法按桶匹配——与 projectStream 同口径）。
        pending = new Map();
        {
          const body = e.content.trim();
          if (body !== "") parts.push(`## Cairn\n\n${body}`);
        }
        break;
      case "assistant_delta":
        pending.set(e.callId, (pending.get(e.callId) ?? "") + e.text);
        break;
      default:
        break; // 工具/思考/元信息：过程，不是对话
    }
  }
  flush(); // 停转：最后一段没被终稿收走的桶在此落定
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
