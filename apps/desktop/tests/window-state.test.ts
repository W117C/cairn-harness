// BrowserWindow 选项判卷（2026-10-18）：只允许传 Electron 真实存在的构造选项。
//
// 背景（真 bug）：窗口位置持久化那轮写了 `restorable: false`，注释说要关掉 macOS 的
// NSWindow 状态恢复。但 Electron 根本没有 restorable 这个选项——electron.d.ts 里
// BrowserWindowConstructorOptions / BaseWindowConstructorOptions 全文无此键，
// `tsc -p tsconfig.json --noEmit` 报 TS2353 ⇒ 桌面打包链（pnpm build 含 tsc）是红的。
// 修法不是加个 `as any` 把类型糊过去，而是删掉这个不存在的键（应用从未注册 restoration，
// 系统本来就不会还原窗口，防覆盖靠的是显式传 bounds + clampToWorkArea）。
//
// 判据为什么值得有：这类「看起来该有、其实不存在」的键名，tsc 一次就能抓到，但只有真的
// 跑 typecheck 才会抓。本判据把它变成桌面套件里的常驻红——CI 不跑打包链也不会漏。
// 同时正向钉住窗口持久化的三个要件仍在场（bounds 显式传 / 夹工作区 / close 时落盘）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const main = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");

describe("BrowserWindow 构造选项", () => {
  it("不传 Electron 不存在的选项（restorable 曾让 tsc 报 TS2353）", () => {
    // 反向锚点：这行必须在删掉之后依然为真——若有人把 restorable 加回来，这里立刻红。
    // 只匹配「真的作为选项传进 BrowserWindow」的形态（行首缩进 + 键 + 冒号），
    // 不去匹配注释里的字面量——修法注释里点名了这个键名，那是有意的文档，不是回归。
    expect(main).not.toMatch(/^\s*restorable:/m);
  });

  it("窗口位置持久化三要件在场（读回 → 夹工作区 → 落盘）", () => {
    expect(main).toContain("readWindowState(statePath)");
    expect(main).toContain("clampToWorkArea(saved, screen.getDisplayMatching(saved).workArea)");
    expect(main).toContain('win.on("close", persistBounds)');
    // 读回值必须真的进构造参数，否则「持久化」只是写了没人读
    expect(main).toContain("x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height");
  });
});
