// 应用动作与命令式句柄：状态与视图共享的类型，不加载组件。
export type PaletteAction = "new-session" | "open-folder" | "new-project" | "toggle-theme" | "cycle-perm" | "toggle-inspector" | "copy-transcript" | "export-transcript" | "find-in-session" | "compact" | "toggle-sidebar" | "view-log";

export interface FindBarHandle {
  step: (dir: 1 | -1) => void;
  focus: () => void;
}

export type PageId = "plugins" | "automation" | "skills" | "memory" | "worktrees";

export type SectionId = "general" | "provider" | "permissions" | "advanced" | "shortcuts" | PageId | "about";
