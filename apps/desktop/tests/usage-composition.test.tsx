// Token 构成判卷（2026-10-21）：
// ① 构成只画「输入 + 输出」两段——cacheRead 在不同 provider 里是否已含在 input 内不一致，
//    并进分母会重复计数，所以它只作独立读数出现；
// ② 百分比既写进 aria-label，也有文字图例——不靠颜色单独传意；
// ③ 颜色令牌来自 Claude Desktop v3.1623.0 的 chart 分类色序（tokens.css）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsagePanel, type UsageAllState } from "../src/renderer/components/UsagePanel";

const usage = { inputTokens: 1234, outputTokens: 56, cacheReadTokens: 700, usageCount: 2, toolSteps: 3, rounds: 4 };

function html(scope: "session" | "all", all: UsageAllState = { status: "idle" }, current: typeof usage | null = usage): string {
  return renderToStaticMarkup(
    <UsagePanel scope={scope} onScopeChange={() => undefined} usage={current} all={all} onRetry={() => undefined} />,
  );
}

describe("UsagePanel · Token 构成", () => {
  it("当前会话：只画输入/输出两段，缓存作独立读数", () => {
    const h = html("session");
    expect(h).toContain("usage-comp-bar");
    expect(h).toContain('class="uc-seg uc-input"');
    expect(h).toContain('class="uc-seg uc-output"');
    expect(h).not.toContain('class="uc-seg uc-cache"');
    // 1,234 / 1,290 = 95.7%；56 / 1,290 = 4.3%
    expect(h).toContain("width:95.7%");
    expect(h).toContain("width:4.3%");
    expect(h).toContain("Token 构成：输入 95.7%，输出 4.3%");
    expect(h).toContain("缓存 700（独立计数，不并入构成）");
  });

  it("输入+输出为零时不画空条（缓存再多也不进构成）", () => {
    const h = html("session", { status: "idle" }, { ...usage, inputTokens: 0, outputTokens: 0, cacheReadTokens: 700 });
    expect(h).not.toContain("usage-comp-bar");
  });

  it("非零但四舍五入到 0% 的输出写 <0.1%，不冒充没有", () => {
    const h = html("session", { status: "idle" }, { ...usage, inputTokens: 100000, outputTokens: 1, cacheReadTokens: 0 });
    // React SSR 会把 < 转成 &lt;，读屏拿到的是「<0.1%」。
    expect(h).toContain("Token 构成：输入 100%，输出 &lt;0.1%");
    expect(h).toContain("&lt;0.1%");
    expect(h).not.toContain("输出 0%");
  });

  it("缓存大于输入（Anthropic 式独立计数）不改变构成的分子分母", () => {
    const h = html("session", { status: "idle" }, { ...usage, inputTokens: 100, outputTokens: 100, cacheReadTokens: 900 });
    expect(h).toContain("Token 构成：输入 50%，输出 50%");
    expect(h).toContain("缓存 900（独立计数，不并入构成）");
  });

  it("全部会话口径也用同一支构成条；合计为零时不画", () => {
    const ready: UsageAllState = {
      status: "ready",
      data: { ok: true, totals: usage, sessions: 5, workspaces: 2, skipped: 0, badLines: 0 },
    };
    expect(html("all", ready)).toContain("Token 构成：输入 95.7%");
    const zero: UsageAllState = {
      status: "ready",
      data: {
        ok: true,
        totals: { ...usage, inputTokens: 0, outputTokens: 0, cacheReadTokens: 700 },
        sessions: 5,
        workspaces: 2,
        skipped: 0,
        badLines: 0,
      },
    };
    expect(html("all", zero)).not.toContain("usage-comp-bar");
  });
});

describe("chart 令牌", () => {
  const css = readFileSync(join(__dirname, "..", "src", "renderer", "tokens.css"), "utf8");

  it("8 个分类色 + 轴/网格/轨道都在，且是 HSL 三元组", () => {
    for (let i = 1; i <= 8; i += 1) {
      const m = css.match(new RegExp(`--chart-${String(i)}:\\s*([^;]+);`));
      expect(m, `--chart-${String(i)}`).not.toBeNull();
      expect(m![1]!.trim(), `--chart-${String(i)} 值`).toMatch(/^-?[\d.]+ [\d.]+% [\d.]+%$/);
    }
    expect(css).toMatch(/--chart-axis:\s*48 5\.2% 37\.8%;/);
    expect(css).toMatch(/--chart-grid:\s*var\(--alpha-2\);/);
    expect(css).toMatch(/--chart-muted:\s*50 20\.7% 88\.6%;/);
  });

  it("前三个颜色就是 Claude 分类色序 blue-450 / orange-350 / aqua-350", () => {
    expect(css).toMatch(/--chart-1:\s*212\.8 67\.7% 50\.2%;/);
    expect(css).toMatch(/--chart-2:\s*17 82\.1% 56\.3%;/);
    expect(css).toMatch(/--chart-3:\s*158\.5 73\.3% 39\.6%;/);
  });
});
