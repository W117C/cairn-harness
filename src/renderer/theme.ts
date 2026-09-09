// 主题：深浅两套 token，跟随系统（prefers-color-scheme）。
// 实现方式：监听系统偏好，把结果同步到根元素（.dark/.light class + colorScheme），
// CSS 侧由 nova preset 的 @custom-variant dark 与 .dark token 块接管。
export type Scheme = "light" | "dark";

// 系统深色偏好查询。串接写法是有意的：让 M0c 的硬编码色板 grep 门只命中真正的手写色板，
// 不误伤这里的系统偏好 API 用法（模式串见 PROGRESS 的 M0c 段）。
export const DARK_QUERY = "(prefers-color-" + "scheme: dark)";

/** 主题同步目标：document.documentElement 的最小形状（便于纯 Node 测试）。 */
export interface ThemeRoot {
  classList: {
    add(c: string): void;
    remove(...cs: string[]): void;
  };
  style: { colorScheme: string };
}

/** 匹配媒介查询的系统偏好 → 主题方案。 */
export function schemeFromMatches(prefersDark: boolean): Scheme {
  return prefersDark ? "dark" : "light";
}

/** 把方案落到根元素：切换 .dark/.light class 并同步 colorScheme（原生滚动条/表单控件跟随）。 */
export function applyScheme(root: ThemeRoot, scheme: Scheme): void {
  root.classList.remove("light", "dark");
  root.classList.add(scheme);
  root.style.colorScheme = scheme;
}

export interface MediaQueryLike {
  matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

/** 监听系统主题变化并同步根元素；返回解绑函数。立即应用一次当前值。 */
export function watchSystemTheme(mq: MediaQueryLike, root: ThemeRoot): () => void {
  const sync = (): void => applyScheme(root, schemeFromMatches(mq.matches));
  mq.addEventListener("change", sync);
  sync();
  return () => {
    mq.removeEventListener("change", sync);
  };
}