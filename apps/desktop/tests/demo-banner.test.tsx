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

  it("服务状态词族与侧栏死 prop 不许复活（第 1060 页）", () => {
    // 页脚服务状态行 2026-11-03 已删；Sidebar 却仍必填一个自己从不读的 providerOk，
    // STR.footer 还留着整族服务状态词（零消费）。清掉之后用这条钉住「不许复活」。
    const sidebar = read("../src/renderer/components/Sidebar.tsx");
    expect(sidebar).not.toContain("providerOk");
    const strings = read("../src/renderer/strings.ts");
    const at = strings.indexOf("footer: {");
    const footer = strings.slice(at, strings.indexOf("},", at));
    expect(footer).not.toMatch(/providerOk|providerBad|providerUnknown|providerShort|providerDemo/);
    // 正对照：绿不是把整块 footer 或演示文案删空换来的。
    expect(footer).toContain("accountTip");
    expect(strings).toContain('chip: "演示模式"');
  });
});
