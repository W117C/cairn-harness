// 空屏「模型服务未配置」横幅（2026-10-18 对照 Claude 桌面端告警条）：
//   · 只在 providerOk === false 时出现（未知不冒充坏）；
//   · 有可操作按钮（去设置），不是纯灰字提示；
//   · 样式走 risk token（暖黄描边/淡底），不是硬编码色。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderBanner } from "../src/renderer/components/ProviderBanner";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("ProviderBanner", () => {
  it("标题、原因、操作按钮都在", () => {
    const html = renderToStaticMarkup(<ProviderBanner onOpenSettings={() => undefined} />);
    expect(html).toContain("模型服务还没配好");
    expect(html).toContain("没找到可用的 API Key");
    expect(html).toContain("去设置");
    expect(html).toContain('role="status"');
  });

  it("App 只在 providerOk === false 的空屏挂载它", () => {
    const app = readAppSurface();
    expect(app).toContain("providerOk === false && (");
    expect(app).toContain("<ProviderBanner");
    expect(app).toContain("setSettingsOpen(true)");
    const css = read("../src/renderer/styles.css");
    expect(css).toMatch(/\.home-banner\s*{[^}]*border:\s*1px solid hsl\(var\(--color-risk\) \/ 35%\)/s);
    expect(css).toMatch(/\.home-banner\s*{[^}]*background:\s*hsl\(var\(--color-risk\) \/ 10%\)/s);
  });
});
