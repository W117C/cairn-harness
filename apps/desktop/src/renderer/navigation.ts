import type { AppDestination, AppPageDestination, PageId, SectionId } from "./app-controls";

export interface PageFilterItem {
  id: string;
  label: string;
}

export const APP_DESTINATIONS: readonly AppDestination[] = [
  "chat",
  "plugins",
  "memory",
  "automation",
];

export const APP_DESTINATION_LABEL: Record<AppDestination, string> = {
  chat: "对话",
  plugins: "插件",
  memory: "记忆",
  automation: "自动化",
};

export const PAGE_CONTEXT_ITEMS = {
  plugins: [
    // 2026-11-02：这一栏此前把「视图」（发现/已安装/可更新）与「分类」（技能/命令…）
    // 混成十条一串，而那三个视图在页内标签条里已经有了 ⇒ 同一件事两处入口。
    // 现在这一栏只做**分类筛选**：视图归页内标签条，两个语义各一处。
    { id: "all", label: "全部能力" },
    { id: "favorites", label: "精选" },
    { id: "skills", label: "技能" },
    { id: "commands", label: "命令" },
    { id: "agents", label: "智能体" },
    { id: "hooks", label: "钩子" },
    { id: "mcp", label: "MCP" },
    { id: "lsp", label: "LSP" },
  ],
  automation: [
    { id: "all", label: "全部" },
    { id: "on", label: "已启用" },
    { id: "off", label: "已暂停" },
  ],
  skills: [],
  memory: [
    { id: "all", label: "全部" },
    { id: "project", label: "项目层" },
    { id: "global", label: "全局层" },
  ],
  worktrees: [],
} as const satisfies Record<PageId, readonly PageFilterItem[]>;

export function pageForDestination(destination: AppDestination): PageId | null {
  return destination === "chat" ? null : destination;
}

export function destinationForSection(section: SectionId): AppDestination | null {
  return section === "plugins" || section === "memory" || section === "automation"
    ? section
    : null;
}

export function defaultPageFilter(page: PageId): string {
  return PAGE_CONTEXT_ITEMS[page][0]?.id ?? "";
}

export function isAppPageDestination(page: PageId): page is AppPageDestination {
  return page === "plugins" || page === "memory" || page === "automation";
}
