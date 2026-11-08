// 结构化笔记的**被动通道**：跨 compaction 的锚点，写在盘上而不是靠模型记在上下文里。
// 质量档把最近几行注入前缀（qualityContextNote，agent-runner）；写入面归模型/业主手写，
// harness 不主动写——原 appendNote/writePlan 写入面零消费者，2026-11-07 收掉。
// 纪律：NOTES.md **只追加**（append-only），压缩只影响投影，不重写已写下的历史。
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const NOTES_DIR = join(".agent", "quality");

function notesDirOf(workspace: string): string {
  return join(workspace, NOTES_DIR);
}

function notesPathOf(workspace: string): string {
  return join(notesDirOf(workspace), "NOTES.md");
}

/** 供上下文注入的笔记摘要：只取最近 N 行，避免把整本笔记重新灌回上下文。 */
export async function notesDigest(workspace: string, maxLines = 12): Promise<string> {
  try {
    const text = await readFile(notesPathOf(workspace), "utf8");
    const lines = text.split("\n").filter((l) => l.startsWith("- "));
    if (lines.length === 0) return "";
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
