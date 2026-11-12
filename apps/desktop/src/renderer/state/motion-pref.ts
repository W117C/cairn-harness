/* 减弱动效偏好（2026-10-28 第 758 页 · 对标 Claude 的 `data-reduce-motion` 根属性）
 *
 * 一手依据：Claude Desktop 3.6556.2 的渲染层 CSS 里，减弱动效有**两个**入口：
 *   ① 媒体查询 `@media (prefers-reduced-motion: reduce)`（系统级）；
 *   ② **根属性** `[data-reduce-motion=true]`——应用自己也能强制降级，
 *      规则形如 `.cds-root:where([data-reduce-motion=true],[data-reduce-motion=true] *)
 *      [data-cds-shimmer-clone]) { display: none }`（扫光克隆层直接不画）。
 *   ⇒ 应用级入口不是「媒体查询的重复」：它让**用户可以在应用里**关掉动效，
 *      与系统设置无关。
 *
 * 本仓原状：只有全局媒体查询那条（styles.css 的 `* { animation-duration: .01ms !important }`）
 * —— 系统开了就降级，但**应用里没有开关**，用户想在应用内减弱动效做不到。
 *
 * 本模块提供那个入口：
 *   · `motionPref` = "system"（跟系统）/ "reduced"（应用内强制减弱）；
 *   · 落位：`html[data-reduce-motion="true"]`（与主题同款：写根属性，不加 class）；
 *   · 持久化：localStorage（键 `cairn.reduceMotion.v1`），与其它窗口级偏好同族。
 *
 * 为什么不用 props 串一层：这是**窗口级**偏好（与侧栏宽、界面密度同族），
 * 落盘在 localStorage、由本模块单点读写；调用方（侧栏「外观」菜单）直接调 setter。
 */

/** 偏好：跟系统 / 应用内强制减弱。 */
export type MotionPref = "system" | "reduced";

/** localStorage 键（窗口级偏好，与 `cairn.sidebar.width` 同族）。 */
export const MOTION_PREF_KEY = "cairn.reduceMotion.v1";

/** 决策（纯函数，判卷面）：偏好 + 系统是否要减弱 ⇒ 根属性写什么。 */
export function motionPrefOf(pref: MotionPref, systemReduced: boolean): boolean {
  if (pref === "reduced") return true;
  return systemReduced;
}

/** 根属性名（与主题的 `data-theme`/`data-mode` 同款：不加 class，只写属性）。 */
export const MOTION_ATTR = "data-reduce-motion";

/** 应用此刻是否要减弱动效（系统媒体查询 ∪ 应用内开关，汇到同一个根属性）。
 *  根属性由 bootMotionPref/setMotionPref 落位；这里既读根属性也读系统事实，
 *  让 JS 侧行为（显式滚动、el.animate、布局延时）与 CSS 认同一份真相。
 *  非浏览器/无 matchMedia（判卷 node 环境）⇒ 只看根属性，读不到就 false。 */
export function appMotionReduced(): boolean {
  try {
    if (document.documentElement.getAttribute(MOTION_ATTR) === "true") return true;
  } catch { /* 没有 document 时只读系统面 */ }
  return systemPrefersReducedMotion();
}

/** 系统是否要减弱动效（纯读，判卷可注入）。 */
export function systemPrefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 读偏好（缺省 = 跟系统）。 */
export function readMotionPref(): MotionPref {
  try {
    return window.localStorage.getItem(MOTION_PREF_KEY) === "reduced" ? "reduced" : "system";
  } catch {
    return "system";
  }
}

/** 写根属性：开 ⇒ 写 `data-reduce-motion="true"`；关 ⇒ 摘掉属性（不写 "false"）。 */
export function applyMotionPref(reduced: boolean): void {
  try {
    if (reduced) document.documentElement.setAttribute(MOTION_ATTR, "true");
    else document.documentElement.removeAttribute(MOTION_ATTR);
  } catch { /* 属性写不上时降级为「只有媒体查询那条」 */ }
}

/** 设偏好并立刻落位；返回落位后的**实际**状态（系统也在减弱时，关掉应用开关仍是减弱）。 */
export function setMotionPref(pref: MotionPref): boolean {
  try {
    window.localStorage.setItem(MOTION_PREF_KEY, pref);
  } catch { /* 存不下则本会话内生效 */ }
  const reduced = motionPrefOf(pref, systemPrefersReducedMotion());
  applyMotionPref(reduced);
  return reduced;
}

/** 启动时落位：读偏好 + 系统事实 ⇒ 写根属性。系统那一侧的变化也跟着走。 */
export function bootMotionPref(): () => void {
  const mq = (() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return null;
    }
  })();
  const apply = (): void => {
    applyMotionPref(motionPrefOf(readMotionPref(), mq?.matches === true));
  };
  apply();
  if (mq === null) return () => undefined;
  const onChange = (): void => { apply(); };
  mq.addEventListener("change", onChange);
  return () => { mq.removeEventListener("change", onChange); };
}
