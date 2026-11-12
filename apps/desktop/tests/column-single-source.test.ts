// 列宽单源判卷（2026-11-07 第 1041 页）。
// 病灶：1200 容器断点只收 .reading / .zone-gate / .zone-composer 三处，首页 .empty 与
// .empty-below 仍留 52rem ⇒ 1440 窗下问候/起手行与输入卡左缘差 48px，一屏两条列宽。
// 修法是把列宽收成 .main 上的 --col-max，断点只改这一个变量；本判卷钉住「八处同读一个变量
// + 回到底部锚点同源 + 气沟同源」，谁再给某一处单独写死列宽（或把断点拆回逐消费者覆盖）立刻红。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

const ruleOf = (selector: string): string => {
  const at = css.indexOf(selector + " {");
  if (at < 0) throw new Error(`missing rule: ${selector}`);
  return css.slice(at, css.indexOf("}", at) + 1);
};

// 同名选择器可能有多条规则（.zone-composer 先有一条定位规则）：取带列宽的那条。
const widthRuleOf = (selector: string): string => {
  let at = css.indexOf(selector + " {");
  while (at >= 0) {
    const block = css.slice(at, css.indexOf("}", at) + 1);
    if (block.includes("max-width:")) return block;
    at = css.indexOf(selector + " {", at + 1);
  }
  throw new Error(`missing width rule: ${selector}`);
};

const CONSUMERS = [
  ".reading",
  '.main[data-empty="true"] .empty',
  ".empty-below",
  ".zone-gate",
  ".zone-composer",
  ".error-strip",
  ".notice-strip",
  ".diagnosis-card",
];

describe("阅读列宽单源（--col-max）", () => {
  it("变量只声明两次：.main 基档 + 1200 容器断点", () => {
    expect((css.match(/--col-max:/g) ?? []).length).toBe(2);
    expect(ruleOf(".main")).toContain("--col-max: min(var(--reading), 100%)");
    const cqStart = css.indexOf("@container (max-width: 1200px)");
    expect(cqStart, "缺 1200 容器断点").toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", cqStart);
    let depth = 1;
    let end = open + 1;
    while (depth > 0 && end < css.length) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}") depth -= 1;
      end += 1;
    }
    const body = css.slice(open + 1, end - 1);
    expect(body).toContain(".main { --col-max: min(46rem, 100%); }");
    // 断点不许再逐消费者覆盖 max-width（旧写法正是病灶）。
    expect(body).not.toContain("max-width");
  });

  it("八个列消费者同读一个变量，不各写死列宽", () => {
    for (const sel of CONSUMERS) {
      const rule = widthRuleOf(sel);
      expect(rule, `${sel} 的列宽要读 --col-max`).toContain("max-width: var(--col-max)");
      expect(rule, `${sel} 不许自带列宽字面量`).not.toMatch(/max-width:\s*min\(/);
    }
    expect(css).not.toContain("max-width: min(46rem");
  });

  it("回到底部锚点同读 --col-max：不按 --reading 另算一条列宽", () => {
    const rule = ruleOf(".jump-latest");
    expect(rule).toContain("right: calc(50% - var(--col-max) / 2 + var(--space-sm))");
    expect(rule).not.toContain("min(var(--reading)");
  });

  it("除 --col-max 定义外，不再有第二处 min(var(--reading))（含横幅/锚点）", () => {
    expect((css.match(/min\(var\(--reading\)/g) ?? []).length).toBe(1);
  });
});

describe("阅读气沟单源（--reading-pad-x）", () => {
  it("只在 .main 上收窄，消费者不各写 41/24/16", () => {
    expect((css.match(/--reading-pad-x:/g) ?? []).length).toBe(3);
    expect(css).toContain(".main { --reading-pad-x: 24px; }");
    expect(css).toContain(".main { --reading-pad-x: 16px; }");
    expect(css).toContain(".main { --reading-pad-x: var(--space-16); }");
    // 令牌不许再落到单个消费者上：只改 .reading 会让首页 hero 与输入卡错开 25px。
    expect(css).not.toMatch(/\.reading\s*\{[^}]*--reading-pad-x\s*:/);
    expect(css).toContain('.main[data-empty="true"] .empty { padding-left: var(--reading-pad-x); padding-right: var(--reading-pad-x); }');
    expect(css).toContain(".empty-below { padding-left: var(--reading-pad-x); padding-right: var(--reading-pad-x); }");
    expect(css).toContain(".zone-composer { padding-left: var(--reading-pad-x); padding-right: var(--reading-pad-x); }");
    expect(ruleOf(".zone-gate")).toContain("--gate-pad-x: var(--reading-pad-x)");
  });
});
