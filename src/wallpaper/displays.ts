// 多显示器：**每屏一张壁纸**的解析与清理（纯函数）。
//
// 我们的壁纸不是系统桌面壁纸，而是应用窗口背后那一层；「每屏一张」= 每个显示器上那个窗口
// 各自用自己那张。所以这一层只解决两件事：
//  ① 解析：这块屏有没有专属壁纸？没有就回落到全局那张（`fallback`）。
//  ② 清理：显示器拔了/换了 id，它的专属项要能**被识别成孤儿**——不静默删，交给调用方决定。
//
// 口径：
//  · id 是 Electron 的 `display.id` 字符串形式（数字字符串）；不是合法 id 的键直接丢弃；
//  · 最多 `MAX_DISPLAY_OVERRIDES` 条（防设置文件被成长）；
//  · 孤儿**不自动删**：`pruneDisplays` 只报告，删不删由调用方写回设置时决定。
export const MAX_DISPLAY_OVERRIDES = 8;
export const DISPLAY_ID_RE = /^[0-9]{1,20}$/;

export interface DisplayWallpaper {
  kind: "image" | "video";
  path: string;
}

export type DisplayMap = Record<string, DisplayWallpaper>;

/** 键与值都合法才留下；越界条目丢弃（返回 kept 与 dropped，调用方可出声）。 */
export function sanitizeDisplayMap(raw: unknown): { kept: DisplayMap; dropped: string[] } {
  const kept: DisplayMap = {};
  const dropped: string[] = [];
  if (typeof raw !== "object" || raw === null) return { kept, dropped };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!DISPLAY_ID_RE.test(key)) { dropped.push(key); continue; }
    const v = value as { kind?: unknown; path?: unknown } | null;
    const kind = v?.kind === "video" ? "video" : v?.kind === "image" ? "image" : null;
    const path = typeof v?.path === "string" && v.path.trim() !== "" && v.path.length <= 4096 ? v.path : null;
    if (kind === null || path === null) { dropped.push(key); continue; }
    if (Object.keys(kept).length >= MAX_DISPLAY_OVERRIDES) { dropped.push(key); continue; }
    kept[key] = { kind, path };
  }
  return { kept, dropped };
}

/** 这块屏用哪张：专属优先，否则回落全局。 */
export function wallpaperForDisplay(
  displayId: string | number,
  map: DisplayMap,
  fallback: DisplayWallpaper | null,
): { source: "display" | "fallback" | "none"; wallpaper: DisplayWallpaper | null } {
  const key = String(displayId);
  const own = map[key];
  if (own !== undefined) return { source: "display", wallpaper: own };
  if (fallback !== null) return { source: "fallback", wallpaper: fallback };
  return { source: "none", wallpaper: null };
}

/** 孤儿（设置里有、当前屏里没有）——只报告，不删。 */
export function pruneDisplays(map: DisplayMap, liveIds: readonly (string | number)[]): { live: string[]; orphans: string[] } {
  const live = new Set(liveIds.map(String));
  const keys = Object.keys(map);
  return { live: keys.filter((k) => live.has(k)), orphans: keys.filter((k) => !live.has(k)) };
}
