// macOS 窗口材质开关（2026-10-21，实验项，默认关）：只在显式环境变量下启用。
// 依据 outputs/claude-design-v3-2026-10-21/VIBRANCY.md 的隔离原型；不把原型当 Claude 对齐证据。
export type WindowVibrancy = {
  vibrancy: "sidebar";
  visualEffectState: "active";
  backgroundColor: "#00000000";
  transparent: true;
};

export function windowVibrancyOptions(
  platform: string,
  env: Record<string, string | undefined>,
  enabled = false,
): WindowVibrancy | null {
  if (platform !== "darwin") return null;
  if (!enabled && env.CAIRN_WINDOW_VIBRANCY !== "sidebar" && env.CAIRN_WINDOW_VIBRANCY !== "1") return null;
  return { vibrancy: "sidebar", visualEffectState: "active", backgroundColor: "#00000000", transparent: true };
}
