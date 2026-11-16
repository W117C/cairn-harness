// 站点授权弹层的 Esc（2026-10-18）：弹层自己关自己；全局 Esc 在弹层打开时让路，
// 否则「按 Esc 关弹层」会顺带把正在跑的本轮停掉。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();
const pane = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

describe("授权弹层 Esc", () => {
  it("全局 Esc 在授权弹层打开时提前返回", () => {
    expect(app).toContain('if (document.querySelector(\'.bp-permit[role="alertdialog"]\') !== null) return;');
  });

  it("弹层自己处理 Escape：清 pending 并阻止冒泡", () => {
    expect(pane).toContain('if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPending(null); }');
  });
});

// 第 1258 页：两张内联确认卡都顶替了打开它们的控件——焦点要自己接住，Esc 只退一层。
describe("内联确认卡：焦点落点与 Esc", () => {
  it("清除确认也自己吃 Esc（全局已让路，卡片不能把按键掉在地上）", () => {
    expect(pane).toContain('if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setConfirmClear(false); }');
  });

  it("打开时搬焦到安全项，关闭只在焦点确实丢了时归还", () => {
    expect(pane).toContain("permitFirstRef.current?.focus()");
    expect(pane).toContain("clearCancelRef.current?.focus()");
    expect(pane).toContain("ref={clearCancelRef}");
    expect(pane).toContain("permitReturnRef.current");
    expect(pane).toContain("back !== null && back.isConnected");
  });
});

// 第 1258 页：关标签时关闭钮随行卸载；焦点交给邻居，条不渲染时交回地址栏。
describe("关闭标签的焦点落点", () => {
  it("关闭钮把激活元素交给 closeTab", () => {
    expect(pane).toContain("closeTab(t.key, e.currentTarget)");
  });

  it("邻居标签按 data-tab-key 找回；只剩一个时落地址栏", () => {
    expect(pane).toContain("data-tab-key={t.key}");
    expect(pane).toContain(".bp-tab[data-tab-key=");
    expect(pane).toContain("(main ?? addrRef.current)?.focus()");
  });
});

// 第 1260 页：授权卡只活在宿主标签上。关掉那张标签，卡片必须一起撤——
// 否则「允许」只会命中 allowAndGo 的兜底分支：目标视图没了，点了什么也不发生。
describe("授权卡与宿主标签", () => {
  it("关闭标签时撤回该标签的未决授权", () => {
    expect(pane).toContain("if (pending !== null && pending.tabKey === key) setPending(null);");
  });
});
