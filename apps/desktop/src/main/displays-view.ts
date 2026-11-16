// 多显示器的**视图合成**：把「设置」与「真实屏列表」拼成面板要的读数。
//
// 抽出来是为了可判：真机只有一块屏时，也能用**两块屏的输入**验这段逻辑
// （否则「每屏一张」永远只有单屏证据）。
import { pruneDisplays, wallpaperForDisplay } from "../../../../src/wallpaper/displays";
import type { WallpaperSettings } from "../../../../src/main/settings";

export interface LiveDisplay {
  id: string;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface DisplayRow extends LiveDisplay {
  source: "display" | "fallback" | "none";
  path?: string;
}

export function resolveDisplays(
  wallpaper: WallpaperSettings,
  live: readonly LiveDisplay[],
): { displays: DisplayRow[]; orphans: string[] } {
  // perDisplay 只记本地媒体（image/video）；网站壁纸是全局一张，不进 perDisplay。
  const fallback = (wallpaper.kind === "image" || wallpaper.kind === "video") && wallpaper.path !== null
    ? { kind: wallpaper.kind, path: wallpaper.path }
    : null;
  const displays = live.map((d) => {
    const r = wallpaperForDisplay(d.id, wallpaper.perDisplay, fallback);
    return { ...d, source: r.source, ...(r.wallpaper === null ? {} : { path: r.wallpaper.path }) };
  });
  const { orphans } = pruneDisplays(wallpaper.perDisplay, live.map((d) => d.id));
  return { displays, orphans };
}
