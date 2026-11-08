// 侧栏密度（2026-10-31，R3）：参考库 28px 高密行。
// 视图偏好，落 localStorage；坏档回舒适，不打断侧栏。
export type SidebarDensity = "comfortable" | "compact";
export const SIDEBAR_DENSITY_KEY = "cairn.sidebar.density.v1";

export function parseSidebarDensity(raw: string | null): SidebarDensity {
  return raw === "compact" ? "compact" : "comfortable";
}
