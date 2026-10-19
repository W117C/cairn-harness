// 复制整段对话（命令面板操作）：Markdown 纯函数 + 接线哨兵。
// 只收用户/助手正文——工具调用、思考、元信息不进导出（过程不是对话）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transcriptFileName, transcriptMarkdown } from "../src/renderer/transcript";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ev = (o: Record<string, unknown>): AgentEvent => o as unknown as AgentEvent;

describe("transcriptMarkdown", () => {
  it("用户/助手按序成文，标题在前，段间空行", () => {
    const md = transcriptMarkdown([
      ev({ type: "user_message", content: "你好" }),
      ev({ type: "tool_call", id: "t1", name: "read_file", args: { path: "a.ts" } }),
      ev({ type: "assistant_message", content: "读完了。" }),
    ], " 会话 A ");
    expect(md).toBe("# 会话 A\n\n## 你\n\n你好\n\n## Cairn\n\n读完了。\n");
  });

  it("工具/思考/空正文不进导出；空标题回落", () => {
    const md = transcriptMarkdown([
      ev({ type: "thinking_delta", callId: "c", text: "内心戏" }),
      ev({ type: "user_message", content: "   " }),
      ev({ type: "assistant_message", content: "只有这句" }),
    ], "   ");
    expect(md).toBe("# 未命名会话\n\n## Cairn\n\n只有这句\n");
    expect(md).not.toContain("内心戏");
  });

  it("用户消息附件写进转录（path 在正文下，类型注明）", () => {
    const md = transcriptMarkdown([
      ev({ type: "user_message", content: "看这个", attachments: [{ path: "/ws/note.txt", kind: "file" }] }),
    ], "T");
    expect(md).toContain("## 你\n\n看这个");
    expect(md).toContain("附件：");
    expect(md).toContain("文件：`/ws/note.txt`");
  });

  it("空会话只有标题", () => {
    expect(transcriptMarkdown([], "空")).toBe("# 空\n");
  });

  it("接线：面板操作 + App 分发 + Markdown 生成", () => {
    const palette = read("../src/renderer/components/CommandPalette.tsx");
    expect(palette).toContain('{ id: "copy-transcript", label: "复制整段对话" }');
    const app = read("../src/renderer/App.tsx");
    expect(app).toContain("transcriptMarkdown(events, title)");
    expect(app).toContain('case "copy-transcript":');
    expect(app).toContain('toast.success("已复制整段对话")');
  });
});


describe("transcriptFileName", () => {
  it("清非法字符、压空白、空标题回落、截断 80 字符", () => {
    expect(transcriptFileName("会话/第 1 轮")).toBe("会话 第 1 轮.md");
    expect(transcriptFileName('a:b*c?d"e<f>g|h')).toBe("a b c d e f g h.md");
    expect(transcriptFileName("   ")).toBe("会话.md");
    expect(transcriptFileName("x".repeat(120)).length).toBe(83); // 80 + ".md"
  });

  it("接线：协议 / 通道 / 主进程 / 面板 / App 五处齐", () => {
    const root = new URL("../../../", import.meta.url);
    const readRoot = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");
    expect(readRoot("src/main/ipc-protocol.ts")).toContain("exportTranscript(markdown: string, suggestedName: string)");
    expect(readRoot("apps/desktop/src/main/channels.ts")).toContain('exportTranscript: "agent:transcript-export"');
    expect(readRoot("apps/desktop/src/main/index.ts")).toContain("dialog.showSaveDialog");
    expect(read("../src/renderer/components/CommandPalette.tsx")).toContain('{ id: "export-transcript", label: "导出整段对话（Markdown 文件）" }');
    expect(read("../src/renderer/App.tsx")).toContain("exportTranscriptFile");
  });
});
