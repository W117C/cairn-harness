// 760 断点收侧栏不再瞬切 · 判卷（2026-11-08 第 1051 页）
//
// 一手依据：responsive-audit.cjs 新增「断点对」取证——每个断点两侧各 1px。
// 结果：1201→1200 / 1121→1120 / 961→960 / 881→880 / 641→640 / 621→620 全部 ≈0，
// 只有 761→760 的 composer 左缘 −256px、正文宽 +255px ⇒ 旧记录的 1440→1200(−144)、
// 1200→1120(−40) 是「跨几百 px 窗口、列固定居中」的自然响应，假阳性，不该改列宽。
// 真跳来自 @media (max-width:760px) 的 `.side-wrap { display: none }`。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const audit = readFileSync(fileURLToPath(new URL("../scripts/responsive-audit.cjs", import.meta.url)), "utf8");

const media760 = (() => {
  const at = css.indexOf("@media (max-width: 760px) {", css.indexOf("窄窗收口"));
  if (at < 0) throw new Error("缺 760 媒体查询");
  let depth = 1, end = css.indexOf("{", at) + 1;
  while (depth > 0) {
    if (css[end] === "{") depth += 1;
    else if (css[end] === "}") depth -= 1;
    end += 1;
  }
  return css.slice(at, end);
})();

describe("760 断点：窄窗收侧栏复用既有过渡机制", () => {
  it("不再 display:none 瞬切", () => {
    expect(media760).not.toContain("display: none");
  });

  it("复用「⌘B 收起」同一套：width 0 + 宽度过渡 + visibility 延迟", () => {
    expect(media760).toContain("width: 0 !important");
    expect(media760).toContain("transition: width var(--t-fast)");
    expect(media760).toContain("visibility 0s var(--t-fast)");
    expect(media760).toContain("pointer-events: none");
  });

  it("既有裁决原样：⌘B 收起规则与宽度过渡基础规则没被改坏", () => {
    expect(css).toContain(".app[data-sidebar=\"collapsed\"] .side-wrap {\n  width: 0 !important; opacity: 0; visibility: hidden; pointer-events: none;");
    expect(css).toContain("transition: width var(--t-fast), opacity var(--t-fast), visibility 0s;");
    expect(css).toContain("body[data-resizing=\"sidebar\"] .side-wrap { transition: none; }");
  });

  it("列宽单源裁决未被推翻：--col-max 仍只声明两次、1200 断点体不覆盖消费者", () => {
    expect((css.match(/--col-max:/g) ?? []).length).toBe(2);
    // .main 基档是长单行（--col-max 混在一串声明里），不能用整条规则字面量匹配
    expect(css).toContain("--col-max: min(var(--reading), 100%)");
    expect(css).toContain("--col-max: min(46rem, 100%)");
  });
});

describe("断点对取证工具（区分阶跃与自然响应）", () => {
  it("PAIRS 每个断点两侧各 1px，含 761→760 与 1201→1200", () => {
    expect(audit).toContain("const PAIRS = [[1201, 1200], [1121, 1120], [961, 960], [881, 880], [761, 760], [641, 640], [621, 620]]");
    expect(audit).toContain("pairDeltas: pairs");
  });

  it("过渡态三时刻采样（display:none 会 mid=0；width 过渡 mid 介于 wide/end 之间）", () => {
    expect(audit).toContain("sideCollapse: { wide: sideWide, mid: sideMid, end: sideEnd, smooth }");
    expect(audit).toContain("sideMid < sideWide - 2 && sideEnd < 2");
  });
});
