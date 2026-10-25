// 第二十遍（业主 2026-10-15 21.53.23 死链「这个放到输出旁边」→ 两轮澄清定「上下文环 → 带上百分数」）：
// 用量环照 v3-lite .ring 重做——环心带上下文百分数（原型 <b>62</b> 同式），环钉在发送/中断钮左侧
// （原型 .bar 列序：模型芯片弹性、ctxRing 与 send 贴右；DOM 序在 .spacer 之后）。
// 拿不到读数时环心「—」且 title 把两种「未知」说清（窗口没声明 vs 本会话还没跑过）——不假报 0。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../src/renderer/components/Composer";
import { STR } from "../src/renderer/strings";

const base = {
  mode: "default" as const,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
  usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 },
  phaseLabel: "执行工具",
  phase: "tool" as const,
  elapsedSec: 0,
  steps: 0,
  onSend: () => undefined,
  onCancel: () => undefined,
  onModeChange: () => undefined,
  onModelChange: () => undefined,
  onCompact: () => undefined,
};

describe("用量环（v3-lite .ring：环心数字 + 贴发送侧）", () => {
  it("上下文有数：环心是百分数（12400/20000 ⇒ 62），title / aria 报同一口径", () => {
    const html = renderToStaticMarkup(
      <Composer
        {...base}
        running={false}
        stopped={false}
        ctxWindow={20_000}
        usage={{ inputTokens: 100, outputTokens: 20, usageCount: 3, cacheReadTokens: 0, lastInputTokens: 12_400 }}
      />,
    );
    expect(html).toContain('<b class="ur-num">62</b>');
    expect(html).toContain("上下文占用 62%");
    expect(html).toContain('aria-label="用量明细：上下文 62%"');
    // 环是 SVG 弧 + 环心数字同场（原型形态；不是换个地方摞文本）
    expect(html).toContain('class="ur-bar"');
  });

  it("窗口已声明但本会话还没跑过：环心「—」+ title 说「暂无数据」（不假报 0）", () => {
    const html = renderToStaticMarkup(<Composer {...base} running={false} stopped={false} ctxWindow={20_000} />);
    expect(html).toContain('<b class="ur-num">—</b>');
    expect(html).toContain("暂无数据");
    expect(html).not.toContain("模型窗口未声明");
  });

  it("模型窗口未声明：环心「—」+ title 说「模型窗口未声明」（两种未知分开说清）", () => {
    const html = renderToStaticMarkup(<Composer {...base} running={false} stopped={false} />);
    expect(html).toContain('<b class="ur-num">—</b>');
    expect(html).toContain("模型窗口未声明");
    expect(html).not.toContain("暂无数据");
  });

  it("环钉在发送/中断钮左侧：DOM 序 = .spacer → 用量环 → 发送钮（原型 .bar 列序）", () => {
    const html = renderToStaticMarkup(<Composer {...base} running={false} stopped={false} />);
    const spacerAt = html.indexOf('class="spacer"');
    const ringAt = html.indexOf('class="usage-ring"');
    const sendAt = html.indexOf('aria-label="发送"');
    expect(spacerAt).toBeGreaterThan(-1);
    expect(ringAt).toBeGreaterThan(spacerAt);
    expect(sendAt).toBeGreaterThan(ringAt);
    // 运行中也一样贴住打断钮（环不随运行状态挪位）
    const running = renderToStaticMarkup(<Composer {...base} running stopped={false} />);
    expect(running.indexOf('class="usage-ring"')).toBeGreaterThan(running.indexOf('class="spacer"'));
    expect(running.indexOf(`aria-label="${STR.composer.stopAria}"`)).toBeGreaterThan(running.indexOf('class="usage-ring"'));
  });
});

// 批 4（全局 UI brief §输入区）：状态条整行拆入环 tooltip（轮/步/tok/缓存/上下文五件套）；
// 发送=强调橙圆钮（原型 .send background:var(--accent)）；运行中=危险红底转圈内嵌变停止钮
// （brief「加载中的转圈放进发送按钮里（变成停止按钮），不要单独出现」）；聚焦描边强调 40%。
describe("批 4 输入区：状态条拆入环 / 强调发送 / 运行中红底转圈 / 聚焦强调描边", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../src/renderer/components/Composer.tsx", import.meta.url), "utf8");
  const meterSrc = readFileSync(new URL("../src/renderer/components/UsageMeter.tsx", import.meta.url), "utf8");

  it("状态条整行已拆：组件与样式层无 status-strip 残留；环 title 带 轮/步/tok/缓存", () => {
    expect(src).not.toContain("status-strip");
    expect(css).not.toMatch(/\.status-strip\s*{/);
    const html = renderToStaticMarkup(
      <Composer
        {...base}
        running={false}
        stopped={false}
        ctxWindow={20_000}
        steps={4}
        usage={{ inputTokens: 100, outputTokens: 20, usageCount: 3, cacheReadTokens: 50, lastInputTokens: 12_400 }}
      />,
    );
    const title = html.match(/title="(上下文占用[^"]*)"/)?.[1] ?? "";
    expect(title).toContain("上下文占用 62%");
    expect(title).toContain("120 tok");
    expect(title).toContain("3 轮");
    expect(title).toContain("4 步");
    expect(title).toContain("缓存命中");
  });

  it("用量明细弹层补 步数 / 上下文 两行（弹层静态不开、SSR 不渲染——源码哨兵钉）", () => {
    // P2 重做后两行文案走 STR（同一组「步数 / 上下文」词条），哨兵钉键名引用。
    expect(meterSrc).toMatch(/<span>\{STR\.composer\.meterSteps\}<\/span>/);
    expect(meterSrc).toMatch(/<span>\{STR\.composer\.meterCtx\}<\/span>/);
  });

  it("发送 = 强调橙圆钮；停止 = 危险红底 + 转圈内嵌（Loader2 旋转，不是静方块）", () => {
    expect(css).toMatch(/\.send-btn\s*{[^}]*background:\s*hsl\(var\(--accent-brand\)\)/s);
    expect(css).toMatch(/\.send-btn\.stop\s*{[^}]*background:\s*hsl\(var\(--color-danger\)\)/s);
    expect(css).toMatch(/\.send-btn\.stop\s+svg\s*{[^}]*animation:\s*spin/s);
    expect(src).toMatch(/aria-label=\{STR\.composer\.stopAria\}[\s\S]{0,240}Loader2/);
  });

  it("聚焦：输入卡描边强调 40%（brief「聚焦描边强调 40%」）", () => {
    expect(css).toMatch(/\.composer-card:focus-within\s*{[^}]*border-color:\s*hsl\(var\(--accent-control\)\s*\/\s*40%\)/s);
  });
});
