// 第 1164 页：SidechatPane 的 sessions/current 按快照与选择记忆。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("SidechatPane 会话索引", () => {
  it("sessions/current useMemo", () => {
    expect(src).toContain("const sessions = useMemo(() => snap?.sessions ?? [], [snap]);");
    expect(src).toContain("const current = useMemo(() => sessions.find((s) => s.id === active) ?? sessions[0] ?? null, [sessions, active]);");
  });
});
