// 渲染韧性判卷（2026-10-25）：
//   · 错误边界的无错路径不包 wrapper（设置页/窗格的直接子元素选择器不能变形）；
//   · 兜底面有 role=alert、重试；页面级另有重新载入；详情不丢错误正文；
//   · 三处落点确实接线（根 / 设置分区 / 窗格），且首启清单重新挂回空屏。
// 「抛错时真的接住」需要运行期渲染，SSR 不执行 componentDidCatch；那一条由
// interaction-smoke 用畸形 search settings 夹具在真实 renderer 里验。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RenderErrorBoundary, RenderErrorFallback } from "../src/renderer/components/RenderErrorBoundary";
import { readAppSurface, readRendererFile } from "./helpers/app-surface";

const noop = () => undefined;

describe("RenderErrorBoundary 兜底面", () => {
  it("无错时原样输出 children（不产生额外 DOM 节点）", () => {
    const html = renderToStaticMarkup(
      <RenderErrorBoundary variant="inline"><div className="ss-page">ok</div></RenderErrorBoundary>,
    );
    expect(html).toBe('<div class="ss-page">ok</div>');
  });

  it("页面级：alert 语义 + 重试 + 重新载入 + 错误正文可展开", () => {
    const err = new Error("boom: 设置分区炸了");
    const html = renderToStaticMarkup(
      <RenderErrorFallback
        variant="page" title="界面遇到问题" body="已拦截" error={err}
        componentStack="\n    at NetworkSection" onRetry={noop} onReload={noop}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("界面遇到问题");
    expect(html).toContain("重试");
    expect(html).toContain("重新载入");
    expect(html).toContain("boom: 设置分区炸了");
    expect(html).toContain("at NetworkSection");
  });

  it("内联级：不摆「重新载入」，其他区域不受影响的文案在场", () => {
    const html = renderToStaticMarkup(
      <RenderErrorFallback
        variant="inline" title="这一块加载失败" body="其他区域仍可使用" error={new Error("x")}
        componentStack="" onRetry={noop} onReload={noop}
      />,
    );
    expect(html).toContain("render-error inline");
    expect(html).toContain("其他区域仍可使用");
    expect(html).not.toContain("重新载入");
  });
});

describe("接线面（防拆掉）", () => {
  const surface = readAppSurface();

  it("根、设置分区、窗格三处都有错误边界", () => {
    expect(readRendererFile("main.tsx")).toContain('<RenderErrorBoundary variant="page">');
    const settings = readRendererFile("components/SettingsPanel.tsx");
    expect(settings).toContain("<RenderErrorBoundary key={section} variant=\"inline\">");
    const paneDock = readRendererFile("components/PaneDock.tsx");
    expect(paneDock).toContain("<RenderErrorBoundary variant=\"inline\">");
    expect(surface).toContain('from "./RenderErrorBoundary"');
  });

  it("首启「设置检查」重新挂回空屏，且只在 onboarded === false 时摆", () => {
    const view = readRendererFile("panes/WorkbenchView.tsx");
    expect(view).toContain('import { OnboardingChecklist } from "../components/OnboardingChecklist";');
    expect(view).toContain("onboarding: readonly OnboardingGroup[];");
    expect(view).toContain("dismissOnboarding: () => void;");
    expect(view).toContain("onboarded, onboarding, dismissOnboarding, injectText");
    expect(view).toMatch(/\{onboarded === false && \(\s*<OnboardingChecklist/);
    expect(view).toContain("groups={onboarding}");
    expect(view).toContain("setSettingsSection(section); setSettingsOpen(true);");
    expect(view).toContain("onDone={dismissOnboarding}");
  });

  it("窗格常驻挂载：按 tabs map 渲染 pane-chunk，而不是只渲染 active 一块", () => {
    const paneDock = readRendererFile("components/PaneDock.tsx");
    expect(paneDock).toMatch(/props\.tabs\.map\(\(kind\) => \(\s*<section/);
    expect(paneDock).toContain('data-active={kind === active}');
    expect(paneDock).toContain('className="pane-stack"');
    // 原生浏览器视图在前台切换时必须被显式收起/放回（CSS 隐藏管不到 WebContentsView）。
    expect(paneDock).toContain("hideAllViews()");
    expect(paneDock).toContain("paneActiveRef");
  });
});
