// 等待占位行的入场手感（2026-11-08 第 1046 页）
//
// 一手依据：本机 Claude.app 主窗口 CSS 的 `animate-[cds-placeholder-reveal_150ms_ease-out]`。
// Cairn 的「等待模型输出」行原先只继承 `.row.assistant` 的 row-in（140ms + 3px 抬升），
// 与「模型还没开始说」的静默感不符；补一档 150ms / 2px 微抬，只动 opacity/transform。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stream } from "../src/renderer/components/Stream";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");

describe("等待占位入场：对标 Claude cds-placeholder-reveal", () => {
  it("动作族 token 150ms ease-out，不写裸时长在组件里", () => {
    expect(tokens).toContain("--t-placeholder-reveal: 150ms var(--ease-out)");
  });

  it("keyframes 只动 opacity + 2px 微抬；等待行规则覆盖 row-in", () => {
    const kf = css.match(/@keyframes cairn-placeholder-reveal\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(kf).toContain("opacity: 0");
    expect(kf).toContain("translateY(2px)");
    expect(kf).not.toContain("scale(");
    const rule = css.match(/\.row\.assistant\.assistant-waiting\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("animation: cairn-placeholder-reveal var(--t-placeholder-reveal) both");
  });

  it("SSR：等待行仍带 status 语义与加载标（加动效不丢锚）", () => {
    const html = renderToStaticMarkup(<Stream rows={[]} streaming waiting />);
    expect(html).toContain('aria-label="等待模型输出"');
    expect(html).toContain("assistant-waiting");
    expect(html).toContain('class="cairn-loader"');
  });

  it("减弱动效：复用既有全局通配块，不新增第二块", () => {
    expect(css.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).toHaveLength(1);
    expect(css).toContain("*, *::before, *::after");
    expect(css).toContain("animation-duration: 0.01ms !important");
  });
});
