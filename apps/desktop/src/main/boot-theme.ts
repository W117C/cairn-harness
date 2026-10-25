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

/** Claude Desktop v3 的 surface-1：亮 #fcfcfb / 暗 #151515。 */
export function bootBackgroundFor(theme: BootTheme): string {
  return theme === "dark" ? "#151515" : "#fcfcfb";
}
