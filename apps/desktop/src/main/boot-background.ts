// 首帧底色的**决策**（设计规格 §10 的 v1.1 项；规格 §11 表 3 的默认裁决）。
//
// 为什么单独一个模块：这段决策原先长在 `main/index.ts` 的装配函数里——那是一段**没有判卷**的
// 早期代码路径（窗口底色只在启动那一瞬有用，跑起来之后就再也测不到了）。判卷要能覆盖的
// 恰恰是「启动那一瞬读到什么就铺什么」，所以把它抽成纯函数：主题底色、壁纸设置、图片解码
// 三样都从外面注入，`main/index.ts` 只负责把 Electron 的真东西递进来。
//
// 三条规则（都可断言）：
//  ① 只有 `image` 走平均色；`video` 与 `none` 一律主题底色（视频首帧要解码才有像素，代价大于收益）；
//  ② 读不出（文件没了 / 不是图片 / 几乎全透明 / PNG 形状不认识）⇒ 回落主题底色，与今天逐字节一致；
//  ③ 壁纸设置的**形状**在进这条路径之前就要校验：非绝对路径一律按「没设壁纸」处理——
//     相对路径没有解析基准，放过去只会在别处炸成一句看不懂的错。
import { bootBackgroundWithTint, wallpaperTintFor, type TintSource } from "./wallpaper-tint";

export type BootWallpaperKind = "none" | "image" | "video";

export interface BootWallpaper {
  kind: BootWallpaperKind;
  path: string | null;
}

export const NO_WALLPAPER: BootWallpaper = { kind: "none", path: null };

/**
 * settings.json 里 `wallpaper` 那一格 → 首帧要用的两字段。
 * 与 `src/main/settings.ts` 的校验同口径：kind 白名单、path 与 kind 从属、路径必须绝对。
 */
export function parseBootWallpaper(raw: unknown, isAbsolute: (p: string) => boolean): BootWallpaper {
  if (raw === null || typeof raw !== "object") return NO_WALLPAPER;
  const w = raw as { kind?: unknown; path?: unknown };
  if (w.kind !== "image" && w.kind !== "video") return NO_WALLPAPER;
  const path = w.path;
  if (typeof path !== "string" || path === "" || !isAbsolute(path)) return NO_WALLPAPER;
  return { kind: w.kind, path };
}

export interface BootBackgroundInput {
  /** 主题底色（`bootBackgroundFor` 的结果）。 */
  themeBackground: string;
  wallpaper: BootWallpaper;
  /** 图片加载面（生产是 `nativeImage`，判卷是假的）。 */
  load: (path: string) => TintSource | null;
}

/** 首帧底色：图片壁纸取平均色，其余/读不出一律主题底色。 */
export function bootBackgroundForWallpaper(input: BootBackgroundInput): string {
  const tint = wallpaperTintFor(input.wallpaper, input.load);
  return bootBackgroundWithTint(input.themeBackground, tint);
}

/**
 * 启动期的一次性缓存：主窗与弹窗创建各调一次，同一张图不该解码两次。
 * 只缓存成功与失败两种结果（都是确定性的）；换路径就重算。
 */
export function createTintMemo(): (key: string, compute: () => string) => string {
  let last: { key: string; value: string } | null = null;
  return (key, compute) => {
    if (last !== null && last.key === key) return last.value;
    const value = compute();
    last = { key, value };
    return value;
  };
}
