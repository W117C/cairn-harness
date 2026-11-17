// 壁纸设置行判卷（2026-11-14 · 设计规格 §5.4）：
// 外观分段里出现壁纸行、三个滑杆，以及选/清两个动作。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneralSection } from "../src/renderer/components/settings/GeneralSection";
import { glassBlurPx } from "../src/renderer/state/wallpaper";
import { DEFAULT_SETTINGS, type AppSettings } from "../../../src/main/settings";

const noop = (): void => undefined;

function markup(over: Partial<AppSettings["wallpaper"]> = {}, unavailable = false): string {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    wallpaper: { ...DEFAULT_SETTINGS.wallpaper, ...over },
  };
  return renderToStaticMarkup(
    <GeneralSection
      settings={settings}
      textSize="md"
      uiSize="2"
      onSave={noop}
      onCtrlTab={noop}
      onTextSize={noop}
      onUiSize={noop}
      onWindowVibrancy={noop}
      onNotify={noop}
      onWallpaperPick={noop}
      onWallpaperOpacity={noop}
      onWallpaperScrim={noop}
      onWallpaperGlass={noop}
      onWallpaperClear={noop}
      wallpaperUnavailable={unavailable}
        onWallpaperRotation={() => {}}
    />,
  );
}

describe("壁纸设置行", () => {
  it("外观分段里有壁纸行：两张滑杆 + 玻璃强度三档（2026-11-17 玻璃质感打磨）", () => {
    const html = markup();
    expect(html).toContain("壁纸");
    // 玻璃从连续滑杆改离散三档（模糊半径随档联动，见 glassBlurPx）；壁纸/压暗两张滑杆保留。
    expect((html.match(/type="range"/g) ?? []).length).toBe(2);
    expect(html).toContain('data-glass-tiers="true"');
    for (const tier of ["mild", "mid", "strong"]) expect(html).toContain(`data-glass-tier="${tier}"`);
    // 当前档 = mid（DEFAULT_SETTINGS.wallpaper.glassAlpha = 0.25），恰一枚 aria-pressed=true。
    expect((html.match(/aria-pressed="true"[^>]*data-glass-tier="mid"/) ?? []).length).toBe(1);
    // 玻璃组内恰一枚选中（组外还有轮换依据的 aria-pressed，不能全局计数）。
    const group = html.slice(html.indexOf('data-glass-tiers="true"'), html.indexOf("</span>", html.indexOf('data-glass-tiers="true"')));
    expect((group.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });

  it("玻璃强度 → 模糊半径映射钉死（轻 8 / 中 14 / 重 22）", () => {
    expect(glassBlurPx(0.12)).toBe(8);
    expect(glassBlurPx(0.16)).toBe(8);
    expect(glassBlurPx(0.25)).toBe(14);
    expect(glassBlurPx(0.3)).toBe(14);
    expect(glassBlurPx(0.45)).toBe(22);
  });

  it("效果预览：设了壁纸出小样、没设不出；图片型用媒体地址", () => {
    expect(markup()).not.toContain('data-wallpaper-preview="true"');
    const set = markup({ kind: "image", path: "/tmp/a.png", revision: 7 });
    expect(set).toContain('data-wallpaper-preview="true"');
    expect(set).toMatch(/cw-preview-media[^>]*src="cairn-wallpaper:\/\/[^"]*7/);
    // 预览里那块玻璃卡用真身同一条地板公式（不是另画示意图）。
    expect(set).toContain("cw-preview-glass");
  });

  it("降级：设了壁纸但媒体读不出 ⇒ 行里点名「文件不可用」；没设壁纸不点名", () => {
    expect(markup({ kind: "image", path: "/tmp/gone.png" }, true)).toContain("文件不可用");
    // 没有壁纸时「不可用」无从谈起（降级态只对已设壁纸有意义）
    expect(markup({ kind: "none", path: null }, true)).not.toContain("文件不可用");
    // 正常态不出现
    expect(markup({ kind: "image", path: "/tmp/a.png" }, false)).not.toContain("文件不可用");
  });

  it("壁纸自成一段：来源 / 轮换 / 依据 / 显示各行分开，不再是一条控件带", () => {
    // 2026-11-16（R3）：整块壁纸原先挂在「外观」段尾的**一条** SettingsRow 里，
    // 真机截图上是一条从右往左堆的控件带。拆行后每件事各占一行，行标签就是它的名字。
    const html = markup();
    for (const label of ["当前壁纸", "定时轮换", "轮换依据", "显示"]) expect(html).toContain(label);
    // 顺序：壁纸各行在「使用习惯」之前——它没有被并回外观段尾以外的位置。
    expect(html.indexOf("当前壁纸")).toBeGreaterThan(-1);
    expect(html.indexOf("使用习惯")).toBeGreaterThan(html.indexOf("当前壁纸"));
  });

  it("没设壁纸时给「选择」入口、设了才给「清除」", () => {
    expect(markup()).toContain("选择图片或视频");
    expect(markup()).not.toContain("清除");
    const set = markup({ kind: "image", path: "/tmp/a.png" });
    expect(set).toContain("清除");
  });
});
