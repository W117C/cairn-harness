// 设置首读失败横幅（v26 / v31）：缺席不摆；有问题时给出文件路径、原因与出路。
//
// 2026-10-30（v31）：出路从「重开 Cairn」升级为真按钮「重新读取」。旧判卷钉过
// 「不许摆『重新检查』」——当时的理由是主进程缓存不会重读，按钮点了不恢复（装饰按钮）。
// 现在 reloadSettings 真的重读盘，判卷改为：按钮必须接在真重读上，且重读后回灌 live state。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsIssueBanner } from "../src/renderer/components/settings-sections";

const issue = { kind: "invalid-json", message: "JSON 解析失败：Unexpected token", path: "/tmp/ws/.agent/settings.json" };

describe("设置文件未生效横幅", () => {
  it("没有问题时整块不渲染（缺席 ≠ 失败）", () => {
    expect(renderToStaticMarkup(<SettingsIssueBanner issue={null} />)).toBe("");
    expect(renderToStaticMarkup(<SettingsIssueBanner issue={undefined} />)).toBe("");
  });

  it("有问题时：警告文案 + 文件路径 + 原因 + 出路（修好后重开）", () => {
    const html = renderToStaticMarkup(<SettingsIssueBanner issue={issue} />);
    expect(html).toContain("设置文件未生效");
    expect(html).toContain("当前按缺省设置运行");
    expect(html).toContain("/tmp/ws/.agent/settings.json");
    expect(html).toContain("JSON 解析失败");
    expect(html).toContain("再重新打开 Cairn");
    expect(html).toContain("ss-banner warn");
    // 没有重读入口时不摆按钮：装饰按钮（点了不恢复）比没有按钮更坏。
    expect(html).not.toContain("重新检查");
    expect(html).not.toContain("重新读取");
  });

  it("有 onReload ⇒ 出「重新读取」真按钮；读取中禁用并换字", () => {
    const html = renderToStaticMarkup(<SettingsIssueBanner issue={issue} onReload={() => undefined} />);
    expect(html).toContain("然后点「重新读取」");
    expect(html).toMatch(/<button[^>]*class="mini-btn ss-banner-action"/);
    expect(html).toContain("重新读取");
    expect(html).not.toContain("重新检查");

    const busy = renderToStaticMarkup(<SettingsIssueBanner issue={issue} onReload={() => undefined} reloading />);
    expect(busy).toContain("正在读取…");
    expect(busy).toMatch(/<button[^>]*disabled=""/);
  });

  it("接线：面板把 onReload 接到真重读（reloadSettings → refresh / loadState / 回灌 live state）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url)), "utf8");
    expect(src).toContain("window.agent.reloadSettings()");
    expect(src).toMatch(/onReload=\{[^}]*reloadFromDisk/);
    const from = src.indexOf("const reloadFromDisk");
    const to = src.indexOf("const save =");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    const fn = src.slice(from, to);
    expect(fn).toContain("refresh();");
    expect(fn).toContain("loadState();");
    expect(fn).toContain("props.onSettingsSaved?.()");
  });
});
