// 统一工具栏判卷（2026-10-20 批 129）。
//
// 本批把「38px 窗口 chrome + 26px 会话条」两条顶栏并成一条 38px 工具栏。
// 这次合并的真正不变量有三条，全部在这里钉住：
//   ① **一条栏**：会话名只有一处落点（工具栏中栏），旧的 .chat-bar 不复存在；
//   ② **标题恒对中栏**：中栏带 = 左翼 1fr + 标题槽 auto + 右翼 1fr（两翼等宽 ⇒ 标题在正中），
//      且带的几何由 TitleBar 按「中栏中心 ± 左右可用空间」算（长名收窄，不滑到右组按钮下）；
//   ③ **拖拽区不被吃掉**：带本体 pointer-events:none（工具栏拖拽区照旧覆盖中栏），
//      但带内可交互件各自接管指针，且工具栏里的 input/button 一律 no-drag
//      （Electron 拖拽区里的输入框打不了字 —— 这是功能级硬要求，不是样式偏好）。
//
// 判据写在结构上（SSR 真 HTML + 样式层文本），不是靠源码字符串的位置猜。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { TitleBar } from "../src/renderer/components/TitleBar";

const CSS = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

const html = renderToStaticMarkup(
  <TitleBar
    sidebarCollapsed={false}
    onToggleSidebar={() => undefined}
    center={<button className="tb-title" aria-keyshortcuts="F2">你好</button>}
    aside={<span className="goal-chip">目标</span>}
    right={<button className="iconbtn sm" aria-label="进入专注模式">◎</button>}
  />,
);

describe("统一工具栏 · 结构", () => {
  it("左组：红绿灯避让 + 侧栏开关（窗口 chrome 在最左）", () => {
    expect(html).toContain('class="tb-left"');
    expect(html).toContain('class="traffic"');
    expect(html).toContain('aria-label="折叠侧栏"');
  });

  it("中栏三段齐：lead / title-slot / trail（两翼等宽 ⇒ 标题恒在正中）", () => {
    expect(html).toContain('class="tb-center"');
    expect(html).toContain('class="tb-lead"');
    expect(html).toContain('class="tb-title-slot"');
    expect(html).toContain('class="tb-trail"');
    // 样式层：两翼必须都是 1fr auto 1fr 的等宽翼（任何一翼改成 auto，标题就被挤偏）
    expect(CSS).toMatch(/\.tb-lead\s*\{[^}]*flex:\s*1 1 0;/s);
    expect(CSS).toMatch(/\.tb-trail\s*\{[^}]*flex:\s*1 1 0;/s);
    expect(CSS).toMatch(/\.tb-title-slot\s*\{[^}]*flex:\s*0 1 auto;/s);
  });

  it("会话名在中栏主体槽里，目标芯片住右翼（芯片不挤偏标题）", () => {
    const slot = html.indexOf('class="tb-title-slot"');
    const name = html.indexOf('class="tb-title"');
    const chip = html.indexOf('class="goal-chip"');
    expect(slot).toBeGreaterThan(-1);
    expect(name).toBeGreaterThan(slot);
    expect(chip).toBeGreaterThan(name);
  });

  it("焦点序：侧栏开关 → 会话名 → 右组（DOM 序即 Tab 序，不靠 tabindex 倒序）", () => {
    const toggle = html.indexOf("折叠侧栏");
    const slot = html.indexOf("tb-title-slot");
    const right = html.indexOf('class="tb-right"');
    expect(toggle).toBeLessThan(slot);
    expect(slot).toBeLessThan(right);
  });
});

describe("统一工具栏 · 拖拽区与可交互件", () => {
  it("工具栏里的 input/button 一律 no-drag（拖拽区里的输入框打不了字）", () => {
    expect(CSS).toMatch(/\.titlebar button,\s*\.titlebar input\s*\{\s*-webkit-app-region:\s*no-drag;/);
  });

  it("中栏带本体不接管指针（工具栏拖拽区照旧覆盖中栏），可交互件各自接管", () => {
    expect(CSS).toMatch(/\.tb-center\s*\{[^}]*pointer-events:\s*none;/s);
    expect(CSS).toMatch(/\.tb-center \.tb-title,\s*\.tb-center \.tb-rename,\s*\.tb-center \.goal-chip\s*\{\s*pointer-events:\s*auto;/s);
  });

  it("几何：中栏带是绝对定位（left/width 由 JS 算，写死像素就是错）", () => {
    expect(CSS).toMatch(/\.tb-center\s*\{[^}]*position:\s*absolute;/s);
  });
});
