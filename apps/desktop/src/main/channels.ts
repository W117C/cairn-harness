// 桥面通道名唯一事实源。INVOKE_CHANNELS 的映射类型是完整性红线：
// AgentApi 新增方法而这里不加行 ⇒ typecheck 红（ipc-protocol 删键同理）。
import type { AgentApi } from "../../../../src/main/ipc-protocol";

export type PushChannel = "onEvent" | "onAsk" | "onAskDone" | "onTerminalData" | "onTerminalExit" | "onBrowserState" | "onPreviewState" | "onMenu";
export type InvokeChannel = Exclude<keyof AgentApi, PushChannel>;

export const PUSH_CHANNELS: { [K in PushChannel]: string } = {
  onEvent: "agent:event",
  onAsk: "agent:ask",
  onAskDone: "agent:ask-done",
  onTerminalData: "agent:terminal-data",
  onTerminalExit: "agent:terminal-exit",
  onBrowserState: "agent:browser-state",
  onPreviewState: "agent:preview-state",
  onMenu: "agent:menu-command",
};

export const INVOKE_CHANNELS: { [K in InvokeChannel]: string } = {
  run: "agent:run",
  decide: "agent:decide",
  submitClarify: "agent:clarify-submit",
  decidePlan: "agent:plan-decide",
  setGoal: "agent:goal-set",
  runCancel: "agent:run-cancel",
  compact: "agent:compact",
  getState: "agent:state",
  getProviderInfo: "agent:provider-info",
  getOnboarding: "agent:onboarding",
  getSettings: "agent:settings-get",
  setSettings: "agent:settings-set",
  listSessions: "agent:sessions-list",
  // v14：跨会话用量账本（头像菜单「用量统计」→「全部会话」；main 只读扫描各工作区日志）。
  usageLedger: "agent:usage-ledger",
  // v15：会话日志尾部（错误条 / 命令面板「查看日志」；main 只读）。
  sessionLog: "agent:session-log",
  createSession: "agent:sessions-create",
  openSession: "agent:sessions-open",
  queueGet: "agent:session-queue-get",
  queueSet: "agent:session-queue-set",
  renameSession: "agent:sessions-rename",
  deleteSession: "agent:sessions-delete",
  forkSession: "agent:sessions-fork",
  revertTurn: "agent:sessions-revert",
  // v4 变更审阅：逐 hunk diff（快照 vs 当前文件）。
  changeDiff: "agent:change-diff",
  // v5 窗格后端：file 窗格（列目录 + 读文本）。
  setWorkspaceContext: "agent:set-workspace-context",
  workspaceListDir: "agent:workspace-list-dir",
  workspaceReadText: "agent:workspace-read-text",
  // v7：路径动作（复制绝对路径 / Finder 显示 / 默认应用打开）。
  workspacePathAction: "agent:workspace-path-action",
  // v7：朗读（macOS say）。
  speakText: "agent:speak-text",
  stopSpeaking: "agent:speak-stop",
  // v5 窗格后端：terminal 窗格（PTY 起停 + 输入）。
  terminalStart: "agent:terminal-start",
  terminalWrite: "agent:terminal-write",
  terminalResize: "agent:terminal-resize",
  terminalKill: "agent:terminal-kill",
  // v5 窗格弹出：独立窗口路由。
  panePopout: "agent:pane-popout",
  // v5 窗格后端：browser 窗格（WebContentsView 起停/边界/导航）。
  browserOpen: "agent:browser-open",
  browserBounds: "agent:browser-bounds",
  browserNav: "agent:browser-nav",
  browserClose: "agent:browser-close",
  // v7：浏览器清除数据 + 元素选择。
  browserClearData: "agent:browser-clear-data",
  browserSetAllowedHosts: "agent:browser-set-allowed-hosts",
  browserPickElement: "agent:browser-pick-element",
  // v6：产品第一批（模板建项 / 预览运行时 / 项目导出 / 连接自检）。
  projectTemplates: "agent:project-templates",
  projectCreateFromTemplate: "agent:project-create-from-template",
  previewStart: "agent:preview-start",
  previewStop: "agent:preview-stop",
  previewStatus: "agent:preview-status",
  // v12：导入诊断（导入已有文件夹先给三态诊断——ADR 0004 §4）。
  projectDiagnose: "agent:project-diagnose",
  projectExport: "agent:project-export",
  providerCheck: "agent:provider-check",
  exportTranscript: "agent:transcript-export",
  listSkills: "agent:list-skills",
  skillBody: "agent:skill-body",
  submitFeedback: "agent:feedback-submit",
  listFeedback: "agent:feedback-list",
  setMessagePinned: "agent:message-pin-set",
  listMessagePins: "agent:message-pin-list",
  listProjects: "agent:projects-list",
  addProject: "agent:projects-add",
  removeProject: "agent:projects-remove",
  setSessionPinned: "agent:session-pin",
  setSessionArchived: "agent:session-archive",
  sessionWorktree: "agent:session-worktree",
  assignSessionProject: "agent:session-assign",
  deleteMemory: "agent:memory-delete",
  pluginDecide: "agent:plugin-decide",
  pluginUserConfigSet: "agent:plugin-user-config-set",
  sidechatCreate: "agent:sidechat-create",
  sidechatAsk: "agent:sidechat-ask",
  sidechatPromote: "agent:sidechat-promote",
  sidechatState: "agent:sidechat-state",
  cardAction: "agent:card-action",
  scheduleSnapshot: "agent:schedule-snapshot",
  scheduleUpsert: "agent:schedule-upsert",
  scheduleDelete: "agent:schedule-delete",
  scheduleRunNow: "agent:schedule-run-now",
  providerKeySet: "agent:provider-key-set",
  providerKeyDelete: "agent:provider-key-delete",
  providerKeyStatus: "agent:provider-key-status",
  createProject: "agent:project-create",
  providerDiscover: "agent:provider-discover",
  providerSave: "agent:provider-save",
  checkUpdate: "agent:check-update",
  openExternal: "agent:open-external",
  // M4-5：dialog 选目录（M3 deferred 收口）——main 端 dialog.showOpenDialog({ openDirectory })，
  // preload 程序化桥自动透传（桥面无逐通道代码，缺行才红）。
  pickDirectory: "agent:pick-directory",
  // v8：dialog 选文件（附件引用「选择文件…」）——main 端 dialog.showOpenDialog({ openFile, multiSelections })。
  pickFiles: "agent:pick-files",
  // v9：Tab 想下一条（业主裁 A②）——main 端按上下文单发模型调用（suggestNextMessage），
  // renderer 原样上屏结果/分类文案。
  suggestNext: "agent:suggest-next",
  // SEMA §3.5/§12：协议版本握手——main 实况版本（IPC_PROTOCOL_VERSION）→ renderer 与构建期
  // 注入的期望版本比对，失配 fail-closed。
  protocolVersion: "agent:protocol-version",
  // v10：能力在场性——搜索端点配没配（口径同 CLI --doctor 的 search 那一格）。
  // 它回答的是「模型为什么少了一把工具」：没配 search.endpoint 时 web_search 整族不注入。
  capabilities: "agent:capabilities",
  // v11：主界面重做批（git 两闸 / 项目内模糊搜索 / 最近打开 / 粘贴落盘 / 快照还原 / Finder 显示）。
  gitStatus: "agent:git-status",
  gitClone: "agent:git-clone",
  workspaceSearch: "agent:workspace-search",
  // v18：会话正文全文检索（只读；主进程扫会话 JSONL，渲染层不碰盘）。
  sessionSearch: "agent:session-search",
  touchProject: "agent:project-touch",
  saveTempFile: "agent:save-temp-file",
  snapshotRestore: "agent:snapshot-restore",
  revealInFinder: "agent:reveal-in-finder",
  attachmentThumb: "agent:attachment-thumb",
};
