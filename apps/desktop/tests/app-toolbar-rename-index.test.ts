// 第 1156 页：工具栏重命名提交/失焦共用 renameOriginalTitle，不再各自 find。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("AppToolbar 重命名原始标题", () => {
  it("renameOriginalTitle useMemo 与两处共用", () => {
    expect(src).toContain("const renameOriginalTitle = barRenaming === null ? \"\" : sessions.find((s) => s.id === barRenaming.id)?.title ?? \"\";");
    expect(src).toContain("if (v !== \"\" && v !== renameOriginalTitle) void renameSessionById(barRenaming.id, v);");
    expect(src).not.toContain("const original = sessions.find((s) => s.id === barRenaming.id)?.title ?? \"\";");
  });
});
