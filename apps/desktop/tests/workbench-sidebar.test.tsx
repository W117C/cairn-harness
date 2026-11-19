import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { Sidebar } from "../src/renderer/components/Sidebar";
import { WorkbenchSidebar } from "../src/renderer/panes/WorkbenchSidebar";
import { runKey } from "../src/renderer/state/session-identity";

// 页脚账户位在侧栏（只在 chat 目的地渲染）⇒ 这里给一份最小可渲染的 props。
const CHAT_SIDEBAR = {
  projects: [],
  sessions: [],
  activeId: null,
  activeWorkspace: null,
  running: new Set<string>(),
  waitingIds: new Set<string>(),
  outcomes: new Map(),
} as unknown as ComponentProps<typeof Sidebar>;

function renderSidebar(
  destination: "chat" | "plugins",
  collapsed = false,
  focus = false,
  chat: ComponentProps<typeof Sidebar> = CHAT_SIDEBAR,
): string {
  return renderToStaticMarkup(
    <WorkbenchSidebar
      destination={destination}
      sidebarCollapsed={collapsed}
      focusMode={focus}
      sidebarWidth={304}
      chatSidebar={chat}
      pageItems={[{ id: "all", label: "全部" }]}
      activeFilter="all"
      onFilter={() => undefined}
      onOpenDestination={() => undefined}
      onSettings={() => undefined}
      onNewTask={() => undefined}
      onStartResize={() => undefined}
      onPersistWidth={() => undefined}
      onKeyResize={() => undefined}
    />,
  );
}

// ADR 0019 1:1（官方首屏真机对照 2026-11-19）：单栏 = 顶部行族（AppRail）→ 中段上下文
// （chat 会话列表 / 目的地筛选）→ 底部账户。判卷按这一轮廓钉。
describe("WorkbenchSidebar（单栏）", () => {
  it("两个目的地都渲染全局行族；目的地上下文只在目的地页挂载", () => {
    expect(renderSidebar("plugins")).toContain('aria-label="插件上下文"');
    expect(renderSidebar("chat")).not.toContain('aria-label="插件上下文"');
    for (const destination of ["chat", "plugins"] as const) {
      const html = renderSidebar(destination);
      expect(html, destination).toContain('aria-label="全局功能"');
      expect(html, destination).toContain('data-row="new"');
      expect(html, destination).not.toContain('aria-label="demo-ws"');
    }
  });

  it("会话列按目的地挂载：chat 在列内、目的地页换成上下文列", () => {
    expect(renderSidebar("chat")).toContain('class="side-wrap"');
    expect(renderSidebar("chat")).toContain('class="side"');
    expect(renderSidebar("plugins")).toContain('class="side-wrap"');
    expect(renderSidebar("plugins")).not.toContain('class="side"');
  });

  it("收起 = 整列 CSS 隐藏但保持挂载（收/开有宽度过渡）；专注 = 整列卸载（官方一致）", () => {
    // ADR 0019 1:1 换钉（官方首屏真机对照 2026-11-19）：单栏下收起不再只是藏会话列——
    // 旧「rail 常驻 + 会话列消失」两栏形制随轨下架。列保持挂载让 width 0 过渡生效。
    expect(renderSidebar("chat", true)).toContain('class="side-wrap"');
    expect(renderSidebar("plugins", true)).toContain('class="side-wrap"');
    expect(renderSidebar("chat", false, true)).not.toContain('class="side-wrap"');
    // CSS 那一半（width 0 + visibility 延迟）由 breakpoint-760 / inspector 判卷钉住。
  });

  it("项目组忙碌点按 workspace + session 的限定键读运行/等门态", () => {
    const project = { id: "p", name: "A", path: "/a", createdAt: 0 };
    const session = { id: "same", workspace: "/a", title: "A", mtimeMs: 0, lines: 1 };
    const base = {
      ...CHAT_SIDEBAR,
      projects: [project],
      sessions: [session],
    } as unknown as ComponentProps<typeof Sidebar>;
    for (const state of [
      { running: new Set([runKey("/a", "same")]), waitingIds: new Set<string>() },
      { running: new Set<string>(), waitingIds: new Set([runKey("/a", "same")]) },
    ]) {
      expect(renderSidebar("chat", false, false, { ...base, ...state })).toContain('class="g-dot"');
    }
    expect(renderSidebar("chat", false, false, {
      ...base,
      running: new Set(["same"]),
      waitingIds: new Set<string>(),
    })).not.toContain('class="g-dot"');
  });
});

describe("用户头像固定在单栏底部", () => {
  it.each(["chat", "plugins"] as const)("%s 的展开与收起态都保留唯一头像菜单", (destination) => {
    for (const collapsed of [false, true]) {
      const html = renderSidebar(destination, collapsed);
      expect((html.match(/class="app-rail-user"/g) ?? []).length, `${destination} collapsed=${collapsed}`).toBe(1);
      expect(html).toContain('aria-haspopup="menu"');
      expect(html).toContain('aria-label="设置、外观与用量"');
      expect(html).toContain('lucide-circle-user');
      expect((html.match(/class="avatar"/g) ?? []).length).toBe(1);
      expect(html).not.toContain('avatar-label');
      expect(html).not.toContain('side-foot');
      expect(html).not.toContain('provider-dot');
    }
  });
});
