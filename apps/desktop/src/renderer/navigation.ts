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
    { id: "discover", label: "发现" },
    { id: "installed", label: "已安装" },
    { id: "updates", label: "可更新" },
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
    { id: "on", label: "运行中" },
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
