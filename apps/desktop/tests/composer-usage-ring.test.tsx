// 第二十遍（业主 2026-10-15 21.53.23 死链「这个放到输出旁边」→ 两轮澄清定「上下文环 → 带上百分数」）：
// 用量环照 v3-lite .ring 重做——环心带上下文百分数（原型 <b>62</b> 同式），环钉在发送/中断钮左侧
// （原型 .bar 列序：模型芯片弹性、ctxRing 与 send 贴右；DOM 序在 .spacer 之后）。
// 拿不到读数时环心「—」且 title 把两种「未知」说清（窗口没声明 vs 本会话还没跑过）——不假报 0。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../src/renderer/components/Composer";
import { UsageMeter } from "../src/renderer/components/UsageMeter";
import { STR } from "../src/renderer/strings";

const base = {
  mode: "default" as const,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
  events: [],
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
    // 环心带单位（2026-11-02 真机订正）：原来只有「62」，看不出是百分比还是步数。
    expect(html).toContain('<b class="ur-num" data-len="2">62<span class="ur-unit">%</span></b>');
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

  it("用量明细弹层（2026-11-04 工作流形制）：容量标题行 + 步数行照在（源码哨兵钉键名引用）", () => {
    // 2026-11-04 重排后「上下文已用」行升格为标题行右值（meterCtxDetail），不再是普通明细行。
    expect(meterSrc).toMatch(/<span>\{STR\.composer\.meterSteps\}<\/span>/);
    expect(meterSrc).toContain("STR.composer.ctxCapacityTitle");
    expect(meterSrc).toContain("STR.composer.meterCtxDetail");
  });

  it("发送 = 强调色圆钮；停止 = 高对比方块，不旋转", () => {
    expect(css).toMatch(/\.send-btn\s*{[^}]*background:\s*hsl\(var\(--accent-brand\)\)/s);
    expect(css).toMatch(/\.send-btn\.stop\s*{[^}]*background:\s*hsl\(var\(--text-000\)\)/s);
    expect(css).not.toMatch(/\.send-btn\.stop\s+svg\s*{[^}]*animation:\s*spin/s);
    expect(src).toMatch(/aria-label=\{STR\.composer\.stopAria\}[\s\S]{0,240}Square/);
  });

  it("聚焦：输入卡描边强调 40%（brief「聚焦描边强调 40%」）", () => {
    expect(css).toMatch(/\.composer-card:focus-within\s*{[^}]*border-color:\s*hsl\(var\(--accent-control\)\s*\/\s*40%\)/s);
  });
});

// 2026-11-02 真机订正（业主截图）：环上凭空多出一颗橙色圆点，圆心只有一个没有单位的「1」。
//   · 圆点 = 弧的**圆头线帽**在低水位下的退化：1% 时弧长只有周长的 1%（≈0.7px），
//     剩下的全是线帽本身 ⇒ 一颗 2.6px 的橙点骑在灰环上，读起来像「这里有个未读通知」，
//     而它其实什么都不表示（真值就是 1%，环本来就该是空的）。
//   · 「1」看不出是百分比还是步数，不悬停不可懂 ⇒ 环心带单位。
describe("用量环：低水位不再退化成一颗圆点 + 环心带单位", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const meter = (used: number, win: number): string =>
    renderToStaticMarkup(
      <UsageMeter
        usage={{ inputTokens: 100, outputTokens: 20, usageCount: 1, cacheReadTokens: 0, lastInputTokens: used }}
        steps={1}
        ctxWindow={win}
        events={[]}
        open={false}
        onOpenChange={() => undefined}
        onCompact={() => undefined}
      />,
    );

  it("弧头是平口（butt）——低水位画成贴着 12 点起笔的细线，不是骑在环上的圆点", () => {
    expect(css).toMatch(/\.usage-ring \.ur-bar\s*{[^}]*stroke-linecap:\s*butt/s);
    // 反向钉：圆头不许回来（它就是那颗圆点的成因）
    expect(css).not.toMatch(/\.usage-ring \.ur-bar\s*{[^}]*stroke-linecap:\s*round/s);
  });

  it("环心带单位：1% 读得懂是百分比，不是步数", () => {
    const html = meter(2_000, 200_000);
    expect(html).toContain('<b class="ur-num" data-len="1">1<span class="ur-unit">%</span></b>');
    expect(html).not.toContain('<b class="ur-num">1</b>');
  });

  it("三位数（100%）缩一档字号——否则整串顶到环的内壁（真机截图量到百分号被环压住）", () => {
    const html = meter(200_000, 200_000);
    expect(html).toContain('<b class="ur-num" data-len="3">100<span class="ur-unit">%</span></b>');
    expect(css).toMatch(/\.usage-ring \.ur-num\[data-len="3"\]\s*{[^}]*font-size:\s*7\.5px/s);
    // 单位跟着数字一起缩（em）⇒ 三位数时不会比数字还宽
    expect(css).toMatch(/\.usage-ring \.ur-unit\s*{[^}]*font-size:\s*0\.68em/s);
  });

  it("拿不到读数时环心仍是「—」（不假报 0，也不带单位）", () => {
    const html = meter(0, 200_000);
    expect(html).toContain('<b class="ur-num">—</b>');
    expect(html).not.toContain("ur-unit");
  });
});

// 2026-11-01 真机订正（业主截图）：用量浮层是唯一没有高度预算的输入区浮层——面板比视口高时，
// 底部那行「压缩历史…」直接被窗缘切掉（用户够不着）；「上下文余量」那行还把中文标签断成两截。
describe("用量浮层：高度预算 + 剩余行的说法", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const meter = (over: Partial<Parameters<typeof UsageMeter>[0]> = {}): string =>
    renderToStaticMarkup(
      <UsageMeter
        usage={{ inputTokens: 100, outputTokens: 20, usageCount: 3, cacheReadTokens: 50, lastInputTokens: 10_300 }}
        steps={4}
        ctxWindow={512_000}
        events={[]}
        open
        onOpenChange={() => undefined}
        onCompact={() => undefined}
        {...over}
      />,
    );

  it("浮层带 .meter-pop（上限 + 自身滚动 ⇒「压缩历史…」够得着）", () => {
    const html = meter();
    expect(html).toContain("meter-pop");
    expect(html).toContain(STR.composer.meterCompact);
    // 高度预算写在 styles.css（.meter-pop），本仓只断言接线面
    expect(styles).toMatch(/\.meter-pop\s*{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
    expect(styles).toMatch(/\.meter-pop \.menu-item\s*{[^}]*position:\s*sticky/s);
  });

  it("标题行右值 = 「{pct}%（{used} / {max}）」（剩余不再单列一行：低水位走警示行）", () => {
    const html = meter();
    expect(html).toContain(STR.composer.ctxCapacityTitle);
    expect(html).toContain("2%（10.3k / 512.0k）");
    expect(html).not.toContain("{max}");
    // 低水位警示行：余量 ≤10% 时在场（截图没有这一格——它只在真低水位时出现）
    const low = meter({ usage: { inputTokens: 100, outputTokens: 20, usageCount: 3, cacheReadTokens: 50, lastInputTokens: 505_000 } });
    expect(low).toContain(STR.composer.meterCtxLow.split("{n}")[0] ?? "余量只剩");
  });
});
