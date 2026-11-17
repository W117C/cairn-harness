// 壁纸视图（2026-11-14 · 设计规格 §3.5）：
//
// 设置 → 视图的投影是**纯函数**（判卷面）；副作用只有两处：写 body 属性、写 CSS 变量。
//
// `data-we-wallpaper` 是 vendored 主题预留的接缝属性名（`vendor/dsh-claude-style/tokens.css`
// 用 `:not([data-we-wallpaper])` 让出 body/#root/对话列的画布）——**唯一写者在本模块**，
// 幂等，不留残值（参照仓踩过「组件行停用后 bundle 不再求值 ⇒ 残留没人清」的坑）。
//
// 依赖方向：渲染层**不 import 主进程模块**（apps/desktop/src/main/*）；协议地址从共享的
// `src/main/wallpaper-protocol.ts` 取常量。
import { useSyncExternalStore } from "react";
import { WALLPAPER_MEDIA_URL } from "../../../../../src/main/wallpaper-protocol";
import type { AppSettings } from "../../../../../src/main/settings";
import { floorFor, type Rgb, type ThemeContrastSpec } from "../derived/wallpaper-contrast";

/** vendored 主题的接缝属性名（不是我们发明的名字）。 */
export const WALLPAPER_ATTR = "data-we-wallpaper";

/**
 * 我们自己的根属性（落在 documentElement 上）：只为一件事存在——**级联权重**。
 *
 * 主题那条 `html[data-theme="dark"] body[data-dsh-claude-style] [data-composer-card]`
 * 的特异性是 (0,3,2)，比任何「普通」的壁纸规则（0,2,1）都高 ⇒ composer 的不透明底色
 * 会压过玻璃。仓规不许在 cds-adapter 之后再插第三个样式 import（cds-parity 钉着），
 * 所以只能把权重抬上去：本属���挂在 html 上，配合 `html[data-theme]` 一起把规则抬到 (0,4,2)。
 */
export const CAIRN_WALLPAPER_ATTR = "data-cairn-wallpaper";

export interface WallpaperView {
  kind: "none" | "image" | "video" | "web";
  url: string | null;
  /** kind=web 时的页面地址（https）。 */
  webUrl?: string | null;
}

/** 媒体地址：协议常量 + revision（破浏览器缓存）。 */
export function wallpaperUrl(revision: number): string {
  return `${WALLPAPER_MEDIA_URL}?v=${String(revision)}`;
}

/** 设置 → 视图（纯函数）。kind 非 none 但没有 path ⇒ 视作无壁纸。 */
export function wallpaperViewOf(settings: AppSettings): WallpaperView {
  const w = settings.wallpaper;
  if (w.kind === "none") return { kind: "none", url: null };
  // 网站壁纸（2026-11-16 业主批「准放 CSP」）：view 里带的是页面地址，不走壁纸协议。
  if (w.kind === "web") return w.url === null ? { kind: "none", url: null } : { kind: "web", url: null, webUrl: w.url };
  if (w.path === null) return { kind: "none", url: null };
  return { kind: w.kind, url: wallpaperUrl(w.revision) };
}

/**
 * 失焦 / 不可见 / **系统休眠或锁屏** ⇒ 暂停视频（省电）。
 *
 * 第三个入参是 v59 的推送（主进程 `powerMonitor` 的 suspend/lock-screen）：锁屏时窗口既没失焦
 * 也没隐藏，只靠前两个判据抓不到——那才是最该省电的时刻（人不在，机器还醒着）。
 */
export function shouldPauseMedia(focused: boolean, visible: boolean, systemPaused = false): boolean {
  return systemPaused || !focused || !visible;
}

/** 接缝属性的唯一写者（body 上是上游接缝、html 上是我们自己的权重属性）。
 *  判卷环境（node，无 DOM）只是不落属性，不抛——视图与失败态本身仍可判。 */
export function applyWallpaperAttr(active: boolean): void {
  if (typeof document === "undefined") return;
  if (active) {
    document.body.setAttribute(WALLPAPER_ATTR, "");
    document.documentElement.setAttribute(CAIRN_WALLPAPER_ATTR, "");
  } else {
    document.body.removeAttribute(WALLPAPER_ATTR);
    document.documentElement.removeAttribute(CAIRN_WALLPAPER_ATTR);
  }
}

/* ── 视图存储：设置面改完后回灌这里（components → state 的允许方向）─────────── */

let current: WallpaperView = { kind: "none", url: null };
/**
 * 降级链的「文件不可用」标记（设计规格 §7）：媒体 404 / 解码失败 ⇒ 撤层 **并** 在设置里点名。
 *
 * 这是**运行期状态**，不是设置字段：settings 里仍然指向那张图（文件回来 / 换台机器就该再试），
 * 失败只影响这一轮显示。任何一次视图重设（新选文件、重读设置）都把它清掉 = 自动重试。
 */
let failed = false;
/** 系统级暂停（v59 推送）：锁屏/休眠时窗口既没失焦也没隐藏，只能由主进程告诉我们。 */
let systemPaused = false;
/**
 * 窗口活跃（v72 推送）：**由主进程按真窗口的 focus/blur 告诉我们**，而不是读 `document.hasFocus()`。
 * 理由见 `main/wallpaper-active.ts`：后台脚本窗口的 hasFocus 会假阴性，代价是视频永远不播。
 * 缺省 true：没收到推送时按「活跃」算——宁可先播，也不要一上来就黑屏。
 */
let windowActive = true;
const listeners = new Set<() => void>();

export function setWallpaperView(view: WallpaperView): void {
  current = view;
  failed = false;
  applyWallpaperAttr(view.kind !== "none");
  for (const l of listeners) l();
}

/** 降级：撤掉媒体层（玻璃面留着），并记下「文件不可用」。 */
export function markWallpaperUnavailable(): void {
  current = { kind: "none", url: null };
  failed = true;
  applyWallpaperAttr(false);
  for (const l of listeners) l();
}

export function wallpaperFailed(): boolean {
  return failed;
}

/** 主进程推来的系统级暂停态（唯一写者是推送订阅，见 `bootWallpaper`）。 */
export function setSystemPaused(paused: boolean): void {
  if (systemPaused === paused) return;
  systemPaused = paused;
  for (const l of listeners) l();
}

/** 主进程推来的窗口活跃态（唯一写者是推送订阅，见 `bootWallpaper`）。 */
export function setWindowActive(active: boolean): void {
  if (windowActive === active) return;
  windowActive = active;
  for (const l of listeners) l();
}

export function wallpaperWindowActive(): boolean {
  return windowActive;
}

export function useWallpaperWindowActive(): boolean {
  return useSyncExternalStore(subscribeWallpaper, wallpaperWindowActive, wallpaperWindowActive);
}

export function wallpaperSystemPaused(): boolean {
  return systemPaused;
}

export function useWallpaperSystemPaused(): boolean {
  return useSyncExternalStore(subscribeWallpaper, wallpaperSystemPaused, wallpaperSystemPaused);
}

/** 设置行读它来显示「文件不可用」（与视图同一份订阅）。 */
export function useWallpaperFailed(): boolean {
  return useSyncExternalStore(subscribeWallpaper, wallpaperFailed, wallpaperFailed);
}

export function subscribeWallpaper(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWallpaperView(): WallpaperView {
  return useSyncExternalStore(subscribeWallpaper, () => current, () => current);
}

/** 改完设置后重读一次（设置真源在主进程，渲染层只读）。 */
export async function refreshWallpaper(): Promise<void> {
  const s = await window.agent.getSettings();
  setWallpaperView(wallpaperViewOf(s));
  applyThemeVars(s);
}

/* ── 主题色 → CSS 变量：颜色从**真实计算样式**读出，零手抄 ────────────────── */

/** 解析 getComputedStyle 的 "rgb(r, g, b)" / "rgba(r, g, b, a)"。 */
export function parseRgb(value: string): Rgb | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (m === null) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

/**
 * 主题色真值：从 DOM 的**计算样式**读，而不是从 tokens 抄。
 *  · 画布 = documentElement 的计算 background-color（vendored 主题始终画 html 画布）；
 *  · 文字 = body 的计算 color（= --text-000）。
 * 读不到（判卷环境无 DOM）就返回 null，不抛。
 */
export function readThemeColors(): { canvas: Rgb; text: Rgb } | null {
  try {
    const canvas = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
    const text = parseRgb(getComputedStyle(document.body).color);
    if (canvas === null || text === null) return null;
    return { canvas, text };
  } catch {
    return null;
  }
}

/**
 * 把玻璃面要用的变量写到根元素：
 *  · --cw-canvas / --cw-text / --cw-glass / --cw-floor（地板百分比）/ --cw-glass-alpha
 *  · --cw-wallpaper-opacity / --cw-scrim
 * 地板权重由 derived 的对比度模型**算出来**（不手抄），所以换主题不用改常量。
 */
/** 2026-11-17（玻璃质感打磨）：玻璃强度档 → 模糊半径（轻 8 / 中 14 / 重 22）。
 *  纯函数：设置页三档与真机身共用同一条映射，判卷直接钉这张表。 */
export function glassBlurPx(glassAlpha: number): number {
  return glassAlpha <= 0.16 ? 8 : glassAlpha <= 0.3 ? 14 : 22;
}

export function applyThemeVars(settings: AppSettings): void {
  const colors = readThemeColors();
  if (colors === null) return;
  const spec: ThemeContrastSpec = {
    text: colors.text,
    canvas: colors.canvas,
    glass: { r: 255, g: 255, b: 255 },
    // 最不利的壁纸 = 与文字同极性的那个极端像素：白字遇白壁纸（读不出）、黑字遇黑壁纸（读不出）。
    // ⚠️ 方向别写反：写反了会算出「地板 33%」，而按真最差格只有 2.18:1 ⇒ 暗色主题遇白壁纸直接破线。
    worstWallpaper: colors.text.r > 128 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 },
  };
  const floor = floorFor(spec);
  const root = document.documentElement.style;
  root.setProperty("--cw-canvas", `rgb(${String(spec.canvas.r)} ${String(spec.canvas.g)} ${String(spec.canvas.b)})`);
  root.setProperty("--cw-text", `rgb(${String(spec.text.r)} ${String(spec.text.g)} ${String(spec.text.b)})`);
  root.setProperty("--cw-glass", "rgb(255 255 255 / var(--cw-glass-alpha))");
  root.setProperty("--cw-floor", `${String(Math.round(floor * 1000) / 10)}%`);
  root.setProperty("--cw-glass-alpha", String(settings.wallpaper.glassAlpha));
  // 2026-11-17（玻璃质感打磨）：顶部 1px 高光 + 内描边（色值由 TS 单点写，CSS 零字面）；
  // 模糊半径随强度档联动（见 glassBlurPx）。
  root.setProperty("--cw-glass-sheen", "rgb(255 255 255 / 0.55)");
  root.setProperty("--cw-glass-edge", "rgb(255 255 255 / 0.10)");
  root.setProperty("--cw-glass-blur", `${String(glassBlurPx(settings.wallpaper.glassAlpha))}px`);
  root.setProperty("--cw-wallpaper-opacity", String(settings.wallpaper.opacity));
  root.setProperty("--cw-scrim", String(settings.wallpaper.scrim));
}

/** 启动：读一次设置、落位属性与变量，订阅主题变化重算地板，并订阅系统级暂停推送。 */
export function bootWallpaper(): void {
  void refreshWallpaper().catch(() => undefined);
  try {
    window.agent.onWallpaperSuspend((p) => { setSystemPaused(p.paused === true); });
    window.agent.onWallpaperActive((p) => { setWindowActive(p.active !== false); });
  } catch { /* 老协议没有这条推送（v59 之前）：不订阅，也不炸 */ }
  try {
    const observer = new MutationObserver(() => {
      void window.agent.getSettings().then((s) => { applyThemeVars(s); }).catch(() => undefined);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-mode"] });
  } catch { /* 没有 MutationObserver 的环境不重算 */ }
}
