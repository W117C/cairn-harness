// 第 1155 页：会话日志标题按 sessions/logTarget 记忆。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("WorkbenchOverlays 日志标题", () => {
  it("logTitle useMemo 与 title={logTitle}", () => {
    expect(src).toContain("const logTitle = useMemo(() => logTarget === null ? \"\" : sessions.find((s) => s.id === logTarget)?.title ?? logTarget, [sessions, logTarget]);");
    expect(src).toContain("title={logTitle}");
  });
});
