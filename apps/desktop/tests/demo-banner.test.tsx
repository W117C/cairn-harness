// 演示模式标识判卷（2026-10-30 · 第 812 页）：
// 默认 provider=demo 时，标题栏必须常驻「演示模式」胶囊（点开模型设置），页脚状态点不许把 demo
// 冒充成绿色「服务正常」。两处都读 STR / 同一个 providerInfo.kind，不靠各写一份。
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

  it("WorkbenchView 只在 kind === demo 时传 demo；Sidebar 用「演示模式」而非「服务正常」", () => {
    const view = read("../src/renderer/panes/WorkbenchView.tsx");
    expect(view).toContain('demo: providerInfo?.kind === "demo"');
    const sidebar = read("../src/renderer/components/Sidebar.tsx");
    expect(sidebar).toContain("STR.footer.providerDemo");
    expect(sidebar).toContain('"demo"');
  });
});
