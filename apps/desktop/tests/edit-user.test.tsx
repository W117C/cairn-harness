// 撤回（编辑并重发，2026-10-24 业主重定名）：行操作里的一支「撤回」——停止生成，fork 到该轮之前，
// 把这条用户消息的原文放回输入框；用户改完再发；原会话保留（可从行菜单删除）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readAppSurface } from "./helpers/app-surface";
import { useMessageActions } from "../src/renderer/state/message-actions";

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
    expect(app).toContain("window.agent.forkSession(sid, round - 1, true, workspace ?? undefined)");
    expect(app).toContain("window.agent.createSession(workspace ?? undefined)");
    expect(app).toContain("setInjectedText(text);");
    expect(app).toContain("onEditRound: handleEditUser");
  });

  it("编辑工作区 B 的同名会话时，分叉、标题和编辑状态都属于 B", async () => {
    const forkSession = vi.fn(async () => ({ ok: true, id: "fork" }));
    const openSession = vi.fn();
    const setEditCtx = vi.fn();
    const injectText = vi.fn();
    const noop = () => undefined;
    let actions!: ReturnType<typeof useMessageActions>;
    function Probe() {
      actions = useMessageActions({
        activeIdRef: { current: "same" },
        activeWorkspaceRef: { current: "/b" },
        eventsRef: { current: [] },
        sessions: [
          { id: "same", workspace: "/a", title: "A", lines: 2, mtimeMs: 1 },
          { id: "same", workspace: "/b", title: "B", lines: 2, mtimeMs: 2 },
        ],
        refreshSessions: async () => undefined, openSession, cancelRunHealRef: { current: null },
        injectText, setEditCtx, setLastError: noop, setEvents: noop,
      });
      return null;
    }
    vi.stubGlobal("window", { agent: { forkSession } });
    try {
      renderToStaticMarkup(createElement(Probe));
      actions.handleEditUser(2, "原消息");
      await vi.waitFor(() => expect(openSession).toHaveBeenCalledExactlyOnceWith("fork", "/b"));
      expect(forkSession).toHaveBeenCalledExactlyOnceWith("same", 1, true, "/b");
      expect(injectText).toHaveBeenCalledExactlyOnceWith("原消息");
      expect(setEditCtx).toHaveBeenCalledExactlyOnceWith({
        originId: "same", originTitle: "B", forkId: "fork", workspace: "/b", round: 2,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
