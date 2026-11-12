// 应用内「减弱动效」判卷（2026-10-28 第 758 页 · 对标 Claude 的 `data-reduce-motion` 根属性）
//
// 一手依据：Claude Desktop 3.6556.2 的渲染层 CSS 里，减弱动效有**两个**入口：
//   ① 媒体查询（系统级）；② **根属性** `[data-reduce-motion=true]`（应用自己也能强制降级）。
// 本仓原状只有 ① ⇒ 用户想在应用内减弱动效做不到。
//
// 判卷钉三件事：
//   ① 决策是纯函数：偏好（跟系统 / 强制减弱）+ 系统事实 ⇒ 根属性写什么；
//   ② 根属性名与落位方式固定（`data-reduce-motion`，写属性不加 class，与主题同款）；
//   ③ CSS 认这一个属性：本仓自己加的动效（逐词到达 / 芯片弹一下 / 光标 / 逐格加载标）必须被它关掉。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOTION_ATTR, appMotionReduced, motionPrefOf } from "../src/renderer/state/motion-pref";
import { readAppSurface } from "./helpers/app-surface";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

describe("减弱动效偏好（对标 Claude 的 data-reduce-motion 根属性）", () => {
  it("① 决策是纯函数：强制减弱 ⇒ 减弱；跟系统 ⇒ 听系统的", () => {
    expect(motionPrefOf("reduced", false)).toBe(true);
    expect(motionPrefOf("system", false)).toBe(false);
    expect(motionPrefOf("system", true)).toBe(true);
  });

  it("② 根属性名固定（与主题同款：写属性不加 class）", () => {
    expect(MOTION_ATTR).toBe("data-reduce-motion");
  });

  it("③ CSS 认这一个属性：本仓自己的动效必须被它关掉", () => {
    // 逐词到达（第 755 页）、芯片弹一下（第 757 页）、流式光标、逐格加载标
    const block = css.slice(css.indexOf('[data-reduce-motion="true"]'));
    expect(block).toContain(".md-word");
    expect(block).toContain(".mp-name");
    expect(block).toContain(".cursor");
    expect(block).toContain(".cairn-loader path");
    expect(block).toContain("animation: none");
  });

  it("④ 接线：启动落位 + 侧栏「外观」菜单里有这个开关（读整个渲染层，不读单文件）", () => {
    const surface = readAppSurface();
    expect(surface).toContain("bootMotionPref()");
    expect(surface).toContain("setMotionPref(");
    expect(surface).toContain("readMotionPref");
    // 菜单项的文案走 STR（源文扫描判卷钉死文案出处）
    expect(surface).toContain("STR.footer.reduceMotion");
  });
});


// 第 1173 页：JS 侧行为与 CSS 认同一份真相——系统媒体查询 ∪ 应用内根属性。
describe("appMotionReduced（系统事实 ∪ 应用内开关）", () => {
  const g = globalThis as unknown as {
    window?: { matchMedia: (q: string) => { matches: boolean } };
    document?: { documentElement: { getAttribute: (k: string) => string | null } };
  };
  const withEnv = (system: boolean, attr: string | null, fn: () => void): void => {
    const hadW = "window" in g, hadD = "document" in g, pw = g.window, pd = g.document;
    g.window = { matchMedia: () => ({ matches: system }) };
    g.document = { documentElement: { getAttribute: () => attr } };
    try { fn(); } finally {
      if (hadW) g.window = pw; else delete g.window;
      if (hadD) g.document = pd; else delete g.document;
    }
  };

  it("三格：系统减弱 / 应用内强制 / 都没有", () => {
    withEnv(true, null, () => expect(appMotionReduced()).toBe(true));
    withEnv(false, "true", () => expect(appMotionReduced()).toBe(true));
    withEnv(false, null, () => expect(appMotionReduced()).toBe(false));
  });

  it("接线：所有 JS 侧降级点走同一份判定，不再各读媒体查询", () => {
    const surface = readAppSurface();
    for (const site of [
      "const expandDelay = appMotionReduced() ? 0 : 260;",
      "const restoreDelay = appMotionReduced() ? 0 : 240;",
      "if (appMotionReduced()) return;",
      'reveal(appMotionReduced() ? "instant" : "smooth");',
      "appMotionReduced() || window.matchMedia",
    ]) expect(surface, site).toContain(site);
    // 旧形状不许悄悄回来（M6 守卫本身仍要读系统媒体查询，故只钉 state/ 与 PaneDock 的三处）。
    expect(surface).not.toContain('const expandDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260;');
    expect(surface).not.toContain('const restoreDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;');
    expect(surface).not.toContain('if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;');
  });
});
