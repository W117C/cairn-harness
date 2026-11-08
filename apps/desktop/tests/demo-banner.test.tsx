// 演示模式标识判卷（2026-10-30 · 第 812 页）：
// 默认 provider=demo 时，标题栏常驻「演示模式」胶囊（点开模型设置）；页脚没有服务状态标签。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("演示模式标识", () => {
  it("标题栏有 tb-demo 胶囊与说明文案", () => {
    const toolbar = read("../src/renderer/panes/AppToolbar.tsx");
    expect(toolbar).toContain('className="tb-demo"');
    expect(toolbar).toContain("STR.demoBanner.chip");
    expect(toolbar).toContain("STR.demoBanner.tip");
    expect(toolbar).toContain("demo === true");
  });

  it("WorkbenchView 只在 kind === demo 时传 demo，页脚不重复显示服务状态", () => {
    const view = read("../src/renderer/panes/WorkbenchView.tsx");
    expect(view).toContain('demo: providerInfo?.kind === "demo"');
    const sidebar = read("../src/renderer/components/Sidebar.tsx");
    // 2026-11-03：页脚账号菜单搬进全局轨底部（AccountMenu）；侧栏不再有服务状态/账号入口。
    expect(sidebar).not.toContain('className="provider-dot"');
    expect(sidebar).not.toContain("side-foot");
    expect(read("../src/renderer/components/AccountMenu.tsx")).toContain("STR.footer.accountTip");
  });
});
