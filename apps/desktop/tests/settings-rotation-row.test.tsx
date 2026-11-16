// 轮换那一行的渲染判卷：开关、间隔输入、把当前加入、候选计数都在。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneralSection } from "../src/renderer/components/settings/GeneralSection";
import { DEFAULT_SETTINGS } from "../../../src/main/settings";
import type { AppSettings } from "../../../src/main/ipc-protocol";

const settings = (patch: Partial<AppSettings["wallpaper"]["rotation"]> = {}): AppSettings => ({
  ...DEFAULT_SETTINGS,
  wallpaper: {
    kind: "image", path: "/tmp/a.png", opacity: 1, scrim: 0.35, glassAlpha: 0.25, revision: 3,
    rotation: { enabled: true, everyMinutes: 30, paths: ["/tmp/a.png", "/tmp/b.png"], lastAt: 0, ...patch },
  },
}) as AppSettings;

const render = (s: AppSettings) => renderToStaticMarkup(
  <GeneralSection
    settings={s}
    textSize="md"
    onSave={() => {}}
    onCtrlTab={() => {}}
    onTextSize={() => {}}
    uiSize="3"
    onUiSize={() => {}}
    onWindowVibrancy={() => {}}
    onNotify={() => {}}
    onWallpaperPick={() => {}}
    onWallpaperOpacity={() => {}}
    onWallpaperScrim={() => {}}
    onWallpaperGlass={() => {}}
    onWallpaperClear={() => {}}
    wallpaperUnavailable={false}
    onWallpaperRotation={() => {}}
  />,
);

describe("设置里的定时轮换", () => {
  it("开关、间隔、加入按钮、候选计数都渲染出来", () => {
    const html = render(settings());
    expect(html).toContain('data-wallpaper-rotation="true"');
    expect(html).toContain("定时轮换");
    expect(html).toContain('value="30"');
    expect(html).toContain('data-wallpaper-rotation-add="true"');
    expect(html).toContain("候选：2");
  });

  it("没选壁纸时「加入轮换」是禁用的（不让人加空路径）", () => {
    const s = settings();
    const html = render({ ...s, wallpaper: { ...s.wallpaper, path: null } });
    expect(html).toMatch(/data-wallpaper-rotation-add="true"[^>]*disabled/);
  });
});
