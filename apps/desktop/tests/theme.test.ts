// 主题应用判卷（设计规范 §4.6）：settings.theme → data-theme 的映射与系统跟随。
// 决策纯函数全分支 + 壳订阅行为（本仓无 jsdom，注入 stub 环境测——与 SSR 判卷同哲学）。
import { describe, expect, it } from "vitest";
import { actualThemeOf, applyTheme, type ActualTheme, type ThemeEnv } from "../src/renderer/theme";

function stubEnv(opts: { dark: boolean }): ThemeEnv & {
  writes: ActualTheme[];
  flips(dark: boolean): void;
  watches: number;
  unwatches: number;
} {
  let systemDark = opts.dark;
  const listeners = new Set<() => void>();
  const self = {
    writes: [] as ActualTheme[],
    watches: 0,
    unwatches: 0,
    setDataTheme: (v: ActualTheme) => { self.writes.push(v); },
    systemDark: () => systemDark,
    watchSystemDark: (onChange: () => void) => {
      self.watches += 1;
      listeners.add(onChange);
      return () => { self.unwatches += 1; listeners.delete(onChange); };
    },
    flips(dark: boolean): void {
      systemDark = dark;
      for (const cb of [...listeners]) cb();
    },
  };
  return self;
}

describe("actualThemeOf（决策纯函数）", () => {
  it("light / dark 固定档不受系统影响", () => {
    expect(actualThemeOf("light", true)).toBe("light");
    expect(actualThemeOf("light", false)).toBe("light");
    expect(actualThemeOf("dark", false)).toBe("dark");
    expect(actualThemeOf("dark", true)).toBe("dark");
  });

  it("system 档跟随系统事实", () => {
    expect(actualThemeOf("system", true)).toBe("dark");
    expect(actualThemeOf("system", false)).toBe("light");
  });
});

describe("applyTheme（壳行为）", () => {
  it("固定档：立即写入一次，不订阅系统", () => {
    const env = stubEnv({ dark: true });
    applyTheme("light", env);
    expect(env.writes).toEqual(["light"]);
    expect(env.watches).toBe(0);
  });

  it("system 档：按系统事实写入并订阅；系统翻转后重写", () => {
    const env = stubEnv({ dark: false });
    applyTheme("system", env);
    expect(env.writes).toEqual(["light"]);
    expect(env.watches).toBe(1);
    env.flips(true);
    env.flips(false);
    expect(env.writes).toEqual(["light", "dark", "light"]);
  });

  it("清理函数解除订阅：清理后系统翻转不再写", () => {
    const env = stubEnv({ dark: false });
    const dispose = applyTheme("system", env);
    dispose();
    expect(env.unwatches).toBe(1);
    env.flips(true);
    expect(env.writes).toEqual(["light"]); // 只有初始那次
  });

  it("固定档的清理函数是安静的（没有订可解，也不抛）", () => {
    const env = stubEnv({ dark: false });
    const dispose = applyTheme("dark", env);
    expect(() => { dispose(); }).not.toThrow();
    expect(env.unwatches).toBe(0);
  });
});
