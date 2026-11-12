// 首帧主题（2026-10-21）：settings.json 里的 theme 是唯一真相；主进程在 createWindow 前
// 把它同步给 nativeTheme，让 BrowserWindow 的 backgroundColor 与 index.html 的
// `prefers-color-scheme` 启动占位使用同一判据，避免「系统暗、应用亮」时先闪一块暗底。
//
// 这三个函数保持纯函数：判卷不需要启动 Electron，也不会把 nativeTheme 的单例带进测试。
export type ThemePreference = "system" | "light" | "dark";
export type BootTheme = "light" | "dark";

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveBootTheme(preference: ThemePreference, systemPrefersDark: boolean): BootTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

/** 启动底色：亮 #fcfcfb（Claude v3 surface-1）/ 暗 #1b1b1b。
 *  第 1053 页业主裁「A 轻度」把暗色画布从 #151515 提亮到 #1b1b1b；
 *  BrowserWindow.backgroundColor 必须跟着 CSS 画布走，否则窗口出现时会先闪一帧旧底色。 */
export function bootBackgroundFor(theme: BootTheme): string {
  return theme === "dark" ? "#1b1b1b" : "#fcfcfb";
}
