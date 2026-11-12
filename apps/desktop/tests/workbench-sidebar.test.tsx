import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { Sidebar } from "../src/renderer/components/Sidebar";
import { WorkbenchSidebar } from "../src/renderer/panes/WorkbenchSidebar";

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

function renderSidebar(destination: "chat" | "plugins", collapsed = false, focus = false): string {
  return renderToStaticMarkup(
    <WorkbenchSidebar
      destination={destination}
      sidebarCollapsed={collapsed}
      focusMode={focus}
      showChatSidebar={destination === "chat" && !collapsed && !focus}
      sidebarWidth={200}
      chatSidebar={CHAT_SIDEBAR}
      pageItems={[{ id: "all", label: "全部" }]}
      activeFilter="all"
      onFilter={() => undefined}
      onOpenDestination={() => undefined}
      onSettings={() => undefined}
      onNewTask={() => undefined}
      onSearch={() => undefined}
      onFiles={() => undefined}
      onTerminal={() => undefined}
      onStartResize={() => undefined}
      onPersistWidth={() => undefined}
      onKeyResize={() => undefined}
    />,
  );
}

describe("WorkbenchSidebar", () => {
  it("switches the context column but keeps the global rail", () => {
    const html = renderSidebar("plugins");

    expect(html).toContain('aria-label="全局功能"');
    expect(html).toContain('aria-label="插件上下文"');
    expect(html).not.toContain('aria-label="demo-ws"');
  });

  it("chat 上下文列按 showChatSidebar 单一判据挂载（收起/专注不渲染）", () => {
    expect(renderSidebar("chat")).toContain('class="side-wrap"');
    expect(renderSidebar("chat", true)).not.toContain('class="side-wrap"');
    expect(renderSidebar("chat", false, true)).not.toContain('class="side-wrap"');
  });
});

describe("用户头像固定在全局导航栏底部", () => {
  it.each(["chat", "plugins"] as const)("%s 的展开、收起和专注态都保留唯一头像菜单", (destination) => {
    for (const [collapsed, focus] of [[false, false], [true, false], [false, true]]) {
      const html = renderSidebar(destination, collapsed, focus);
      const rail = html.match(/<nav class="app-rail"[\s\S]*?<\/nav>/)?.[0] ?? "";
      expect(rail).toContain('class="app-rail-user"');
      expect(rail).toContain('aria-haspopup="menu"');
      expect(rail).toContain('aria-label="设置、外观与用量"');
      expect(rail).toContain('lucide-circle-user');
      expect((html.match(/class="avatar"/g) ?? []).length).toBe(1);
      expect(html).not.toContain('avatar-label');
      expect(html).not.toContain('side-foot');
      expect(html).not.toContain('provider-dot');
    }
  });
});
