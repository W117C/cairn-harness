// 最近一次 run 的工作区（记忆项目层根 / 插件面 / 孤儿 worktree 扫描 / sidechat 共用）。
// 单一事实源：只有装配根 runAgent 经 setRunWorkspace 写；读方一律 getLastWorkspace()。
let lastWorkspace: string | null = null;

export function setRunWorkspace(ws: string | null): void {
  lastWorkspace = ws;
}

export function getLastWorkspace(): string | null {
  return lastWorkspace;
}
