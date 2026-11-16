// 壁纸选文件的**决策壳**（设计规格 §3.3）。
//
// 抽出来的理由与 `boot-background` 同款：原生面板本身不可自动化点选，但**面板之外**的每一跳
// （取消算不算失败、选完怎么校验、非法文件怎么回）都可以判；而「面板到底有没有被调起」可以
// 用真 Electron 的关窗取消来验（窗口关掉 ⇒ 面板随之消失 ⇒ Promise 结算）。
//
// 契约：
//  · 取消是**合法结果**（`canceled: true`，不是 error）；用户反悔不该看到红字。
//  · 选中的路径一律过 `validateWallpaperFile`（类型/存在/大小），渲染层永远拿不到没验过的路径。
import type { WallpaperPickResult } from "./wallpaper";

/** 只认这一份扩展名白名单（与 `wallpaper.ts` 的分类同一组；改一处要改两处 ⇒ 判卷钉住）。 */
export const WALLPAPER_PICK_FILTERS = [
  { name: "图片与视频", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "webm", "mov"] },
] as const;

export interface WallpaperOpenDialogOptions {
  title: string;
  properties: readonly string[];
  filters: readonly { name: string; extensions: readonly string[] }[];
}

export interface WallpaperOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export type WallpaperPickOutcome = WallpaperPickResult & { canceled?: boolean };

export interface PickWallpaperOptions {
  /** 注入面：生产是 `dialog.showOpenDialog`（有窗口时挂 sheet，没窗口时独立面板）。 */
  openDialog: (options: WallpaperOpenDialogOptions) => Promise<WallpaperOpenDialogResult>;
  /** 注入面：生产是 `validateWallpaperFile`。 */
  validate: (path: string) => Promise<WallpaperPickResult>;
}

export function wallpaperDialogOptions(): WallpaperOpenDialogOptions {
  return { title: "选择壁纸", properties: ["openFile"], filters: WALLPAPER_PICK_FILTERS };
}

export async function pickWallpaper(options: PickWallpaperOptions): Promise<WallpaperPickOutcome> {
  const picked = await options.openDialog(wallpaperDialogOptions());
  const first = picked.filePaths[0];
  if (picked.canceled || first === undefined || first === "") return { ok: false, canceled: true };
  return options.validate(first);
}
