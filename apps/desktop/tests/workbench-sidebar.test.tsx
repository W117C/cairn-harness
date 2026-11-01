import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { Sidebar } from "../src/renderer/components/Sidebar";
import { WorkbenchSidebar } from "../src/renderer/panes/WorkbenchSidebar";

const CHAT_SIDEBAR = {} as ComponentProps<typeof Sidebar>;

describe("WorkbenchSidebar", () => {
  it("switches the context column but keeps the global rail", () => {
    const html = renderToStaticMarkup(
      <WorkbenchSidebar
        destination="plugins"
        sidebarCollapsed={false}
        focusMode={false}
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

    expect(html).toContain('aria-label="全局功能"');
    expect(html).toContain('aria-label="插件上下文"');
    expect(html).not.toContain('aria-label="demo-ws"');
  });
});
