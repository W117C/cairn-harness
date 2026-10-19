// 编辑并重发（2026-10-18）：行操作里补一支「编辑」——在新分支里填入这条用户消息的原文，
// 用户改完再发；原会话不动。round>1 fork 到上一轮保住前文；round=1 没有前置上下文 ⇒ 新建空会话。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("编辑并重发", () => {
  it("用户行有编辑按钮（铅笔 + 明确 aria/标题）", () => {
    const stream = read("../src/renderer/components/Stream.tsx");
    expect(stream).toContain("Pencil");
    expect(stream).toContain("onEditRound?: (round: number, text: string) => void;");
    expect(stream).toContain('aria-label={`编辑第 ${String(r.round)} 轮消息（新建分支）`}');
    expect(stream).toContain("actions.onEditRound?.(r.round, r.text)");
  });

  it("App 分两径：round>1 fork 上一轮；round=1 新建会话；都只填不发", () => {
    const app = read("../src/renderer/App.tsx");
    expect(app).toContain("const handleEditUser = useCallback((round: number, text: string): void => {");
    expect(app).toContain("window.agent.forkSession(sid, round - 1, true)");
    expect(app).toContain("window.agent.createSession(activeWorkspaceRef.current ?? undefined)");
    expect(app).toContain("setInjectedText(text);");
    expect(app).toContain("onEditRound: handleEditUser");
  });
});
