// 主题的事实源只有一个：AppSettings（#20）。
// 修之前的形状：hydrateSettingsFields 上面刚按 settings 把 aria-pressed 摆好，末尾又
// `syncThemeButtons()` 按本地变量（＝localStorage 首帧缓存）盖回去 ⇒ settings.theme 写而不读。
// 判法：把那段水合函数单独取进 vm 跑，**故意不提供 localStorage**——它一旦被读就抛，
// 等于"缓存冒充事实源"当场红。真换肤与重启还原由 panels-check B3b/B4 在真窗口里实测。
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

function hydrate(st: Record<string, unknown>) {
  const start = source.indexOf("  function hydrateSettingsFields(st) {");
  const end = source.indexOf("  const settingsBodyEl = ", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const applyTheme = vi.fn();
  const syncThemeButtons = vi.fn();
  const context: Record<string, unknown> = {
    applyTheme,
    syncThemeButtons,
    parseWorkspace: (v: string) => v,
    document: { querySelectorAll: () => [] },
    $: () => null,
    // 没有 localStorage：水合阶段读缓存＝退回旧缺陷，让它直接抛
  };
  runInNewContext(source.slice(start, end), context);
  (context.hydrateSettingsFields as (s: Record<string, unknown>) => void)(st);
  return { applyTheme, syncThemeButtons };
}

it("settings.theme 三个合法值各自真的应用一次（不是只刷按钮）", () => {
  for (const t of ["system", "light", "dark"]) {
    const { applyTheme, syncThemeButtons } = hydrate({ theme: t });
    expect(applyTheme).toHaveBeenCalledWith(t);
    expect(syncThemeButtons).not.toHaveBeenCalled();
  }
});

it("非法 theme 不把垃圾写进 data-theme（未知值交给按钮，不交给屏幕）", () => {
  const { applyTheme, syncThemeButtons } = hydrate({ theme: "neon" });
  expect(applyTheme).not.toHaveBeenCalled();
  expect(syncThemeButtons).toHaveBeenCalledOnce();
});

it("缺 theme 字段（旧设置文件）也不炸", () => {
  const { applyTheme } = hydrate({ workspace: null });
  expect(applyTheme).not.toHaveBeenCalled();
});
