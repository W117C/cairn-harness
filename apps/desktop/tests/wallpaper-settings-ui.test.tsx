// 壁纸设置行判卷（2026-11-14 · 设计规格 §5.4）：
// 外观分段里出现壁纸行、三个滑杆，以及选/清两个动作。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneralSection } from "../src/renderer/components/settings/GeneralSection";
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
  it("外观分段里有壁纸行与三个滑杆", () => {
    const html = markup();
    expect(html).toContain("壁纸");
    expect((html.match(/type="range"/g) ?? []).length).toBe(3);
  });

  it("降级：设了壁纸但媒体读不出 ⇒ 行里点名「文件不可用」；没设壁纸不点名", () => {
    expect(markup({ kind: "image", path: "/tmp/gone.png" }, true)).toContain("文件不可用");
    // 没有壁纸时「不可用」无从谈起（降级态只对已设壁纸有意义）
    expect(markup({ kind: "none", path: null }, true)).not.toContain("文件不可用");
    // 正常态不出现
    expect(markup({ kind: "image", path: "/tmp/a.png" }, false)).not.toContain("文件不可用");
  });

  it("没设壁纸时给「选择」入口、设了才给「清除」", () => {
    expect(markup()).toContain("选择图片或视频");
    expect(markup()).not.toContain("清除");
    const set = markup({ kind: "image", path: "/tmp/a.png" });
    expect(set).toContain("清除");
  });
});
