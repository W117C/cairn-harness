// 微交互层判卷（2026-10-22 设计面）：动效要有**档位纪律**，否则「有动效」会退化成「到处都在动」。
//
// 三条纪律（都对着 tokens.css 里那把尺）：
//   ① **微反馈档 = --t-instant(60ms)**：hover / 按下 / 行选中 / 聚焦。
//      令牌注释自己写着「微反馈：hover / 按下 / 勾选（Claude dur-fast 60ms）」——
//      此前实现把这一族全压在 --t-fast(140ms) ⇒ 文档与实现的漂移（手感偏钝）。
//   ② **微反馈档只准过渡颜色系属性**：background / color / border-color / box-shadow /
//      opacity / transform / stroke-*。width/height/top/left/right/margin/padding/inset/
//      font-size/grid-template-* 一律不许——那些会触发布局，悬停一扫就是一排重排。
//   ③ **结构档留在 --t-fast/--t-med**：侧栏收展、分组展开这类有明确时长的面，
//      不许被"顺手"降到 60ms（那会让大面位移显得仓促）。
//
// 外加两条护栏：全仓不许 `transition: all`（它把没打算动的属性也带上）；
// 降级面（prefers-reduced-motion）必须仍然全局中和——动效是加法，**减法必须随时能撤销**。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 取某个选择器规则块的内容（选择器到下一个 `}` 之间）。 */
function blockOf(selector: string): string {
  const re = new RegExp(`(?:^|\\})\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, "m");
  return re.exec(css)?.[1] ?? "";
}

/** 该规则块里被过渡的属性名（`transition: a var(--x), b var(--y)` ⇒ [a, b]）。 */
function transitionedProps(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/transition:\s*([^;]+);/g)) {
    for (const part of (m[1] ?? "").split(",")) {
      const prop = (part.trim().split(/\s+/)[0] ?? "").trim();
      if (prop === "" || prop === "none") continue;
      out.push(prop);
    }
  }
  return out;
}

/** 微反馈族：hover / 按下 / 行选中 / 聚焦。 */
const MICRO = [
  ":focus-visible",
  ".iconbtn", ".mini-btn", ".btn", ".ctl", ".row-action", ".add-project-btn",
  ".menu-item", ".cp-item", ".ss-row", ".session:hover", ".ss-opt", ".theme-opt", ".opt",
  ".tpl-card", ".start", ".err-retry", ".tool-head", ".avatar", ".side-new", ".sp-back",
  ".side-search", ".side-search-x", ".sp-nav-search", ".sp-nav-search-x",
  ".sw", ".composer-card", ".usage-scope button", ".provider-dot",
  ".pane-handle", ".pane-gridline", ".mod-sidebar-resize::after",
];

/** 颜色系白名单：这些属性过渡不触发布局（transform/stroke 走合成器）。 */
const COLORISH = /^(background|background-color|color|border-color|border-.*|box-shadow|opacity|transform|stroke|stroke-dashoffset|fill|outline-color|text-decoration-color|filter)$/;

/** 会触发布局的属性（微反馈档里出现即红）。 */
const LAYOUT = /^(width|height|top|left|right|bottom|inset|margin|margin-.*|padding|padding-.*|font-size|line-height|grid-template-.*|flex-basis|min-width|max-width|min-height|max-height|all)$/;

describe("微交互层：档位纪律", () => {
  it("令牌把微反馈定成 60ms（判据的上游）", () => {
    expect(tokens).toMatch(/--t-instant:\s*60ms/);
    expect(tokens).toMatch(/--t-fast:\s*140ms/);
  });

  it("微反馈族逐个走 --t-instant（不许 --t-fast）", () => {
    const wrong: string[] = [];
    for (const sel of MICRO) {
      const block = blockOf(sel);
      if (block === "") { wrong.push(`${sel}（找不到规则块）`); continue; }
      if (!/transition:/.test(block)) { wrong.push(`${sel}（没有过渡）`); continue; }
      if (/var\(--t-fast\)/.test(block)) wrong.push(`${sel}（还压在 --t-fast）`);
      if (!/var\(--t-instant\)/.test(block)) wrong.push(`${sel}（没走 --t-instant）`);
    }
    expect(wrong, `微反馈档没归位：\n${wrong.join("\n")}`).toEqual([]);
  });

  it("微反馈档只过渡颜色系属性（不许触发布局）", () => {
    const bad: string[] = [];
    for (const sel of MICRO) {
      for (const prop of transitionedProps(blockOf(sel))) {
        if (LAYOUT.test(prop)) bad.push(`${sel} → ${prop}`);
        else if (!COLORISH.test(prop)) bad.push(`${sel} → ${prop}（不在颜色系白名单）`);
      }
    }
    expect(bad, `微反馈档过渡了会重排的属性：\n${bad.join("\n")}`).toEqual([]);
  });

  it("结构档留在 --t-fast/--t-med（不许被顺手降到 60ms）", () => {
    expect(blockOf(".side-wrap")).toMatch(/transition:[^;]*var\(--t-fast\)/);
    expect(blockOf(".group-body")).toMatch(/transition:[^;]*var\(--t-fast\)/);
    expect(blockOf(".usage-ring .ur-bar")).toMatch(/transition:[^;]*var\(--t-med\)/);
  });

  it("焦点环是「亮起来」而不是啪地出现", () => {
    expect(blockOf(":focus-visible")).toMatch(/transition:\s*box-shadow var\(--t-instant\)/);
  });

  it("全仓不许 transition: all（会把没打算动的属性也带上）", () => {
    expect(css).not.toMatch(/transition:\s*all/);
  });

  it("降级面仍然全局中和（动效是加法，减法必须随时能撤销）", () => {
    const block = blockOf("@media (prefers-reduced-motion: reduce)");
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });
});
