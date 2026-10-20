/* 主题应用（设计规范 §4.6，Claude 蓝本）：
   settings.theme（system / light / dark）→ 文档 data-theme 属性（data 属性切换，
   非两套 class）。system 模式跟随系统并监听变化（matchMedia）。
   结构与 DOM 壳分离——决策是纯函数（判卷面），壳是可注入环境
   （产品取浏览器 document/matchMedia；判卷注入 stub，本仓无 jsdom）。 */

export type ThemePref = "system" | "light" | "dark";
export type ActualTheme = "light" | "dark";

/** 偏好 + 系统暗色事实 → 实际主题（纯函数，唯一决策点）。 */
export function actualThemeOf(pref: ThemePref, systemDark: boolean): ActualTheme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/** 壳环境：写属性 / 读系统值 / 订阅系统变化（返回解除函数）。 */
export interface ThemeEnv {
  setDataTheme(value: ActualTheme): void;
  systemDark(): boolean;
  watchSystemDark(onChange: () => void): () => void;
}

/** 产品环境：document + matchMedia。 */
export function browserThemeEnv(): ThemeEnv {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  return {
    setDataTheme: (v) => {
      document.documentElement.setAttribute("data-theme", v);
      document.body.toggleAttribute("data-ds-dark-theme", v === "dark");
    },
    systemDark: () => mq.matches,
    watchSystemDark: (onChange) => {
      mq.addEventListener("change", onChange);
      return () => { mq.removeEventListener("change", onChange); };
    },
  };
}

/** 应用主题偏好；返回清理函数（切偏好/卸载时调用，解除系统监听）。
   非 system 偏好不订阅（固定主题下系统翻转与我们无关）。 */
export function applyTheme(pref: ThemePref, env: ThemeEnv): () => void {
  const apply = (): void => { env.setDataTheme(actualThemeOf(pref, env.systemDark())); };
  apply();
  if (pref !== "system") return () => undefined;
  return env.watchSystemDark(apply);
}
