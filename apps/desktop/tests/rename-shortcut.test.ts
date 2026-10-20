// F2 重命名当前会话（2026-10-18）：桌面肌肉记忆；输入框聚焦时不劫持；快捷键表同步。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const shortcuts = readFileSync(fileURLToPath(new URL("../src/renderer/shortcuts.ts", import.meta.url)), "utf8");

describe("F2 重命名", () => {
  it("裸 F2 在非输入框里触发重命名；输入框里让路；主页给回执（2026-10-18）", () => {
    expect(app).toContain('if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {');
    expect(app).toContain("if (!h.startRename()) toast(STR.shortcut.renameNeedsSession);");
    // 2026-10-20：改名状态**绑定到发起时那条会话**（{id, text}）——
    // 提交时用绑定的 id，不用 activeId（否则切过会话会把 B 改名成 A 的标题）。
    expect(app).toContain("setBarRenaming({ id: sid, text: sessions.find((s) => s.id === sid)?.title ?? sid });");
    // 有会话才 return true；主页 return false（快捷键层据此给回执，不再静默吞键）。
    expect(app).toContain("if (sid === null) return false;");
    expect(app).toContain("return true;");
  });

  it("hotkeysRef 两处都接 startRename；速查表有 F2 行", () => {
    expect(app.match(/startRename: startBarRename/g)?.length).toBe(2);
    expect(shortcuts).toContain('{ keys: "F2", what: "重命名当前会话（点工具栏会话名亦可）" }');
  });
});
