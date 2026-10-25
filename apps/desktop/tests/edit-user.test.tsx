// 撤回（编辑并重发，2026-10-24 业主重定名）：行操作里的一支「撤回」——停止生成，fork 到该轮之前，
// 把这条用户消息的原文放回输入框；用户改完再发；原会话保留（可从行菜单删除）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("撤回（编辑并重发）", () => {
  it("用户行有撤回按钮（Undo2 + 明确 aria/标题）", () => {
    const stream = readAppSurface();
    expect(stream).toContain("Undo2");
    expect(stream).toContain("onEditRound?: (round: number, text: string) => void;");
    expect(stream).toContain('aria-label={`撤回第 ${String(r.round)} 轮消息（停止生成，放回输入框，可改后重发）`}');
    expect(stream).toContain("actions.onEditRound?.(r.round, r.text)");
  });

  it("撤回先停生成（runCancel 前置），再分两径：round>1 fork 上一轮；round=1 新建会话；都只填不发", () => {
    const app = readAppSurface();
    expect(app).toContain("const handleEditUser = useCallback((round: number, text: string): void => {");
    expect(app).toContain("cancelRunHealRef.current?.(sid);");
    expect(app).toContain("window.agent.forkSession(sid, round - 1, true)");
    expect(app).toContain("window.agent.createSession(activeWorkspaceRef.current ?? undefined)");
    expect(app).toContain("setInjectedText(text);");
    expect(app).toContain("onEditRound: handleEditUser");
  });
});
