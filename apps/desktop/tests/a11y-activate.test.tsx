// 键盘可达性判卷（2026-10-18）：`role="button"` 的自绘元素必须能Enter/Space 激活。
//
// 背景（真机实证的缺口）：插件/自动化/技能/记忆四页的列表项都是
// `div[role=button][tabIndex=0] onClick=…`——鼠标正常，纯键盘用户聚焦后按 Enter 没反应。
// Sidebar 会话行与 Stream 思考行各自手写了 Enter/Space，此处四份列表项全漏。
// 修法：收编成 activates() 公件（与原生 button 同口径），四页统一接。
//
// 判据不只「文件里有 activates」——那会被一处 import 骗过。逐页钉到具体调用点：
//   ① 每个 role=button 的 div 都必须带 onKeyDown，且 onKeyDown 里调 activates；
//   ② activates 自身的行为（Enter/Space 激活、target 须为宿主、modifier 不激活）；
//   ③ 反向：不能再有「只有 onClick 没有 onKeyDown」的 div[role=button]。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activates } from "../src/renderer/components/a11y-activate";

const appPage = readFileSync(fileURLToPath(new URL("../src/renderer/components/AppPage.tsx", import.meta.url)), "utf8");

/** 逐条抽出 `role="button"` 的元素开标签，看它自己有没有 onKeyDown（跨行的开标签要摊平）。
 *  开标签 = 从最近的 "<div" 到该元素属性结束。属性里可能有 `=>`（onClick={() => …}），
 *  所以不能用「第一个 >」当边界——遇到 `=>` 里的 `>` 会提前截断。以属性花括号配平收口。 */
function buttonTagOpenTags(src: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf('role="button"'); i !== -1; i = src.indexOf('role="button"', i + 1)) {
    const start = src.lastIndexOf("<div", i);
    if (start === -1) continue;
    // 从 start 起扫：JSX 属性值 `{…}` 内的 `>` 不算标签结束；只有深度 0 的 `>` 才算。
    let depth = 0;
    let end = -1;
    for (let j = start; j < src.length; j++) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      else if (c === ">" && depth === 0) { end = j; break; }
    }
    if (end === -1) continue;
    out.push(src.slice(start, end + 1));
  }
  return out;
}

describe("role=button 元素的键盘可达", () => {
  it("AppPage 每个 role=button 都带 onKeyDown 且调用 activates", () => {
    const tags = buttonTagOpenTags(appPage);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toContain("onKeyDown");
      expect(tag).toContain("activates(e)");
    }
  });

  it("反向锚点：抹掉 activates 接线后，四个列表项必须全部被判为「缺键盘」", () => {
    // 这条钉的是「判据本身不是空转」：把接线删掉，上面那条判据必须红。
    // 若哪天 AppPage 改成了别的方式激活（比如换成真 <button>），这条会先失败并提示改判据，
    // 而不是让上面的绿灯变成假承诺。
    const stripped = appPage.split("\n").filter((line) => !line.includes("activates(e)") && !line.startsWith("import { activates }")).join("\n");
    expect(stripped).not.toBe(appPage);
    const bad = buttonTagOpenTags(stripped).filter((t) => !t.includes("onKeyDown"));
    expect(bad.length).toBe(buttonTagOpenTags(appPage).length);
  });

  it("activates：Enter / Space 激活；target 不是宿主则不激活", () => {
    expect(activates({ key: "Enter", target: "self", currentTarget: "self" })).toBe(true);
    expect(activates({ key: " ", target: "self", currentTarget: "self" })).toBe(true);
    // 行内真 button 的 Enter 冒泡上来不能顺带触发外层（一次按键只做一件事）
    expect(activates({ key: "Enter", target: "inner", currentTarget: "self" })).toBe(false);
    expect(activates({ key: " ", target: "inner", currentTarget: "self" })).toBe(false);
    // 其余键与 modifier 组合都不算激活（⌘Enter 属于应用快捷键）
    for (const k of ["a", "Tab", "Escape", "ArrowDown", "Spacebar"]) {
      expect(activates({ key: k, target: "self", currentTarget: "self" })).toBe(false);
    }
  });

  it("Sidebar / Stream 的既有手写实现与公件同口径（不倒退）", () => {
    const sidebar = readFileSync(fileURLToPath(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url)), "utf8");
    const stream = readFileSync(fileURLToPath(new URL("../src/renderer/components/Stream.tsx", import.meta.url)), "utf8");
    for (const src of [sidebar, stream]) {
      // Enter 与 Space 都激活（与 activates 同口径；Native button 的两键语义）
      expect(src).toContain('e.key === "Enter" || e.key === " "');
    }
    // Sidebar 会话行内有真 button（「…」），必须只在宿主自身聚焦时处理，
    // 否则行内按钮的 Enter 会顺带切会话——一次按键做两件事。
    expect(sidebar).toContain("e.target !== e.currentTarget");
  });
});
