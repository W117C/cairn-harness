// 重启回到上次会话（2026-10-18）：写入 key、启动恢复；恢复要走 openSession（含事件/队列加载），
// 只 activate 会「标题回来了、内容没回来」；⌘N 回主页要清 key。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();

describe("上次会话恢复", () => {
  it("启动读 key；恢复用 openSession 而不是裸 activate", () => {
    expect(app).toContain('parseLastSession(window.localStorage.getItem("cairn.lastSession.v1"))');
    expect(app).toContain("decideLastSessionRestore({");
    expect(app).toContain("if (decision.kind === \"restore\") { openSession(decision.id, decision.workspace ?? undefined); return; }");
    expect(app).toContain("}, [sessionsLoaded, sessions, activeId, openSession]);");
  });

  it("写 key：存 id + workspace；只有用户主动 newSession 才清", () => {
    expect(app).toContain("serializeLastSession({ id: activeId, workspace: sessionWs ?? null })");
    expect(app).toContain("if (activeId === null) return;");
    expect(app).toContain("}, [activeId, activeWorkspace, sessionsLoaded, sessions]);");
    const ns = app.slice(app.indexOf("const newSession = useCallback"), app.indexOf("newSessionRef.current = newSession"));
    expect(ns).toContain('window.localStorage.removeItem("cairn.lastSession.v1");');
  });
});
