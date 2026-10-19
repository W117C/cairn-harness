// 重启回到上次会话（2026-10-18）：写入 key、启动恢复；恢复要走 openSession（含事件/队列加载），
// 只 activate 会「标题回来了、内容没回来」；⌘N 回主页要清 key。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

describe("上次会话恢复", () => {
  it("启动读 key；恢复用 openSession 而不是裸 activate", () => {
    expect(app).toContain('window.localStorage.getItem("cairn.lastSession.v1")');
    expect(app).toContain("if (id !== null && sessions.some((s) => s.id === id)) { openSession(id); return; }");
    expect(app).toContain("}, [sessionsLoaded, sessions, activeId, openSession]);");
  });

  it("写 key：有活动会话则存，回主页（null）则清", () => {
    expect(app).toContain('window.localStorage.setItem("cairn.lastSession.v1", activeId);');
    expect(app).toContain('if (activeId === null) window.localStorage.removeItem("cairn.lastSession.v1");');
    expect(app).toContain("}, [activeId, sessionsLoaded]);");
  });
});
