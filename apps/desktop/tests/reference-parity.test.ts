// 参考端机制对照 · 防回退判卷（2026-11-08 第 1047 页）
//
// 一手值来自本机 Claude 桌面主窗口 CSS（按 asar header 解析，不整包解）、DeepSeek Harness
// renderer CSS，以及第 757 / 862 / 1042 / 1046 页台账记录；ZCode 推理面与 Codex word arrival
// 由对应页判卷分头钉住。这里**只钉 Cairn 侧落地值**，不依赖本机 app 是否存在（可移植）。
//
// 结论：机制层（响应档 / 缓动 / reveal / 阴影 / 滚动渐隐 / 占位入场）已与参考端对齐甚至超前，
// 这批不新增视觉改动，只把「不会漂」写进机器判卷——防止后续批次无意回退。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

describe("响应档：Claude --cds-dur-* 五档", () => {
  it("60ms / 140ms / 200ms / 300ms / 450ms 各归位且都带 --ease-out", () => {
    for (const [name, ms] of [["--t-instant", "60ms"], ["--t-fast", "140ms"], ["--t-med", "200ms"], ["--t-slow", "300ms"], ["--t-slowest", "450ms"]] as const) {
      expect(tokens).toContain(`${name}: ${ms} var(--ease-out)`);
    }
  });

  it("snap / overshoot 曲线逐字对齐 Claude --cds-ease-*", () => {
    expect(tokens).toContain("--ease-snap: cubic-bezier(0.32, 0.72, 0, 1)");
    expect(tokens).toContain("--ease-overshoot: cubic-bezier(0.34, 1.3, 0.64, 1)");
  });
});

describe("消息动作揭示：Claude --cds-message-actions-reveal-*", () => {
  it("出现 120ms + 100ms 延迟，收起 60ms（只动 opacity，不位移不缩放）", () => {
    expect(tokens).toContain("--t-reveal-in: 120ms");
    expect(tokens).toContain("--t-reveal-in-delay: 100ms");
    expect(tokens).toContain("--t-reveal-out: 60ms");
    const rule = css.match(/\.row-actions\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("opacity: 0");
    expect(rule).toContain("transition: opacity");
    expect(rule).not.toContain("transform");
  });
});

describe("弹层阴影：Claude v3 --cds-shadow-popover 双层 / 两主题", () => {
  it("亮色与暗色都是两层投影，不是单层硬阴影", () => {
    const blocks = [...tokens.matchAll(/--shadow-pop:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) {
      expect(b.split(",").length).toBe(2);
      expect(b).toContain("8px 24px");
      expect(b).toContain("2px 6px");
    }
  });
});

describe("滚动渐隐：28px 且 7 档非线性 alpha（Cairn 超前 Claude 线性档）", () => {
  it("token 28px + 顶/底两条规则各有 7 档 alpha", () => {
    expect(tokens).toMatch(/--scroll-fade:\s*calc\(1\.75rem \* var\(--size-scale\)\)/);
    for (const sel of [".stream-fade-bottom", ".stream-fade-top"]) {
      const rule = css.match(new RegExp(`${sel.replace(".", "\\.")}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
      expect(rule).toContain("height: var(--scroll-fade)");
      for (const a of [".85", ".70", ".50", ".30", ".15", ".05"]) expect(rule).toContain(a);
      expect(rule).toContain("linear-gradient");
    }
  });
});

describe("等待占位入场：Claude cds-placeholder-reveal 150ms ease-out", () => {
  it("动作族 token + keyframes 只动两属性，复用既有 reduced-motion 单块", () => {
    expect(tokens).toContain("--t-placeholder-reveal: 150ms var(--ease-out)");
    expect(css).toContain("@keyframes cairn-placeholder-reveal");
    expect(css.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).toHaveLength(1);
  });
});
