// 站点授权弹层的 Esc（2026-10-18）：弹层自己关自己；全局 Esc 在弹层打开时让路，
// 否则「按 Esc 关弹层」会顺带把正在跑的本轮停掉。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const pane = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

describe("授权弹层 Esc", () => {
  it("全局 Esc 在授权弹层打开时提前返回", () => {
    expect(app).toContain('if (document.querySelector(\'.bp-permit[role="alertdialog"]\') !== null) return;');
  });

  it("弹层自己处理 Escape：清 pending 并阻止冒泡", () => {
    expect(pane).toContain('if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPending(null); }');
  });
});
