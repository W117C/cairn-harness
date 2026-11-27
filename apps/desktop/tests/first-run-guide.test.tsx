import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirstRunGuide, type FirstRunGuideProps } from "../src/renderer/components/FirstRunGuide";
import { STR } from "../src/renderer/strings";
import { readAppSurface } from "./helpers/app-surface";

const noop = (): void => undefined;
const complete = async (): Promise<void> => undefined;

function render(over: Partial<FirstRunGuideProps> = {}): string {
  return renderToStaticMarkup(
    <FirstRunGuide
      active
      providerReady={false}
      projectReady={false}
      taskReady={false}
      onConnect={noop}
      onChooseProject={noop}
      onStart={noop}
      onComplete={complete}
      {...over}
    />,
  );
}

describe("FirstRunGuide", () => {
  it("未激活或三步都完成时不占空屏", () => {
    expect(render({ active: false })).toBe("");
    expect(render({ providerReady: true, projectReady: true, taskReady: true })).toBe("");
  });

  it("首次进入只指第一步，三步文案都来自事实源", () => {
    const html = render();
    expect(html).toContain(`aria-label="${STR.empty.firstRun.label}"`);
    expect(html).toContain(STR.empty.firstRun.connect);
    expect(html).toContain(STR.empty.firstRun.project);
    expect(html).toContain(STR.empty.firstRun.task);
    expect(html).toContain('data-step="provider" data-current="true"');
    expect(html).not.toContain('data-step="project" data-current="true"');
  });

  it("已完成第一步后，焦点语义移到第二步", () => {
    const html = render({ providerReady: true });
    expect(html).toContain('data-step="provider"');
    expect(html).toContain("first-run-step is-done");
    expect(html).toContain('data-step="project" data-current="true"');
    expect(html).not.toContain('data-step="provider" data-current="true"');
  });

  it("跳过入口有可读名称", () => {
    expect(render()).toContain(`aria-label="${STR.empty.firstRun.skip}"`);
  });

  it("接线：WorkbenchView 渲染它，完成状态走同一条 setSettings 持久化", () => {
    const surface = readAppSurface();
    expect(surface).toContain("<FirstRunGuide");
    expect(surface).toContain("active={deps.onboarded === false && deps.sessionsLoaded && providerOk !== null}");
    expect(surface).toContain("onComplete={deps.completeOnboarding}");
    expect(surface).toContain("setOnboarded(s.onboarded)");
    expect(surface).toContain("setSettings({ onboarded: true })");
  });
});
