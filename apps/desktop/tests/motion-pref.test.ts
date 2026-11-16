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

// 第 1309 页：应用内开关与系统偏好在 CSS 上必须同语义。
// 此前属性块只写了本仓自有的 5 个选择器 ⇒ 插件页 spinner / 骨架、网络设置 spinner、
// 主题点呼吸、侧栏骨架扫光只在系统偏好下才停；侧栏「外观」里那句
// 「应用内强制减弱动效（与系统设置无关）」是假的。
describe("应用内减弱动效与系统偏好同语义（整域中和 + 可读帧例外）", () => {
  const APP = '[data-reduce-motion="true"]';

  /** 从某个选择器起点取它所在规则的规则体（含花括号）。 */
  function bodyAt(start: number): string {
    const open = css.indexOf("{", start);
    if (open === -1) return "";
    return css.slice(open, css.indexOf("}", open) + 1);
  }

  it("整域中和：*, *::before, *::after 与系统块同值同范围", () => {
    const at = css.indexOf(`${APP} *,`);
    // 锚点找不到时 bodyAt(-1) 会从文件第一个花括号开始读，后面四条会假绿。
    expect(at, "缺少应用内整域中和规则").toBeGreaterThan(-1);
    const prelude = css.slice(at, css.indexOf("{", at));
    expect(prelude).toContain(`${APP} *::before`);
    expect(prelude).toContain(`${APP} *::after`);
    const body = bodyAt(at);
    expect(body).toContain("animation-duration: 0.01ms !important");
    expect(body).toContain("animation-iteration-count: 1 !important");
    expect(body).toContain("transition-duration: 0.01ms !important");
    expect(body).toContain("scroll-behavior: auto !important");
  });

  it("带 stagger 延迟/末帧不可读的动效停成可读帧（与系统块同一组例外）", () => {
    const exceptions: [string, string[]][] = [
      [`${APP} .cairn-loader path`, ["animation: none", "opacity: 1"]],
      [`${APP} .side-skeleton-row::after`, ["animation: none", "transform: translateX(100%)"]],
      [`${APP} .gen-bar[data-running="true"]`, ["animation: none", "hsl(var(--accent-brand) / 40%)"]],
      [`${APP} .dot.running`, ["animation: none"]],
      [`${APP} .dot.waiting::after`, ["animation: none"]],
      // 2026-11-17：glyph.pending 的 svg 自旋规则已删（执行中字形 = CairnLoader 逐格点亮，
      // 图形不转），app 内块里的对应例外随之退役——与系统块保持同一组例外。
      [`${APP} .row.think[data-running="true"]::before`, ["animation: none", "opacity: .6", "transform: none"]],
      [`${APP} .change-preview`, ["animation: none"]],
    ];
    for (const [sel, decls] of exceptions) {
      const at = css.indexOf(sel);
      expect(at, `${sel} 缺失`).toBeGreaterThan(-1);
      const body = bodyAt(at);
      for (const d of decls) expect(body, `${sel} 缺 ${d}`).toContain(d);
    }
  });
});
