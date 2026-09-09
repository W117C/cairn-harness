// 主题跟随系统：根元素（.dark/.light + colorScheme）随 matchMedia 切换（纯 Node，假 matchMedia）。
import { describe, expect, it } from "vitest";
import { applyScheme, schemeFromMatches, watchSystemTheme, type ThemeRoot } from "../src/renderer/theme";

function fakeRoot(): ThemeRoot & { has(c: string): boolean } {
  const classes = new Set<string>();
  return {
    classList: {
      add: (c) => classes.add(c),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
    },
    style: { colorScheme: "" },
    has: (c) => classes.has(c),
  };
}

function fakeMediaQuery(initialDark: boolean) {
  let matches = initialDark;
  const listeners: Array<() => void> = [];
  return {
    get matches() {
      return matches;
    },
    flip(): void {
      matches = !matches;
      for (const l of listeners) l();
    },
    addEventListener: (_type: "change", l: () => void) => listeners.push(l),
    removeEventListener: (_type: "change", l: () => void) => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
}

describe("主题跟随系统", () => {
  it("schemeFromMatches：深色偏好 → dark，浅色 → light", () => {
    expect(schemeFromMatches(true)).toBe("dark");
    expect(schemeFromMatches(false)).toBe("light");
  });

  it("applyScheme：根元素 class 与 colorScheme 同步切换", () => {
    const root = fakeRoot();
    applyScheme(root, "dark");
    expect(root.has("dark")).toBe(true);
    expect(root.has("light")).toBe(false);
    expect(root.style.colorScheme).toBe("dark");
    applyScheme(root, "light");
    expect(root.has("light")).toBe(true);
    expect(root.has("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
  });

  it("watchSystemTheme：系统主题切换时根元素随之切换；解绑后不再跟随", () => {
    const mq = fakeMediaQuery(false);
    const root = fakeRoot();
    const unbind = watchSystemTheme(mq, root);
    expect(root.has("light")).toBe(true); // 立即应用当前值
    mq.flip();
    expect(root.has("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    mq.flip();
    expect(root.has("light")).toBe(true);
    unbind();
    mq.flip();
    expect(root.has("light")).toBe(true); // 解绑后保持不变
  });
});
