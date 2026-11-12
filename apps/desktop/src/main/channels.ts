// 桥面通道名唯一事实源。INVOKE_CHANNELS 的映射类型是完整性红线：
// AgentApi 新增方法而这里不加行 ⇒ typecheck 红（ipc-protocol 删键同理）。
import type { AgentApi } from "../../../../src/main/ipc-protocol";

export type PushChannel = "onEvent" | "onAsk" | "onAskDone" | "onTerminalData" | "onTerminalExit" | "onBrowserState" | "onPreviewState" | "onMenu" | "onNotificationOpen";
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
  onNotificationOpen: "agent:notification-open",
};

export const INVOKE_CHANNELS: { [K in InvokeChannel]: string } = {
  run: "agent:run",
  decide: "agent:decide",
  submitClarify: "agent:clarify-submit",
  decidePlan: "agent:plan-decide",
  setGoal: "agent:goal-set",
  runCancel: "agent:run-cancel",
  // 第 9 点：轮中插话（与 run-cancel 相邻，语义相反：一个收束、一个继续）。
  runSteer: "agent:run-steer",
  compact: "agent:compact",
  getState: "agent:state",
  getProviderInfo: "agent:provider-info",
  getOnboarding: "agent:onboarding",
  getSettings: "agent:settings-get",
  setSettings: "agent:settings-set",
  reloadSettings: "agent:settings-reload",
  searchSettingsGet: "agent:search-settings-get",
  searchSettingsSave: "agent:search-settings-save",
  searchSettingsTest: "agent:search-settings-test",
  listSessions: "agent:sessions-list",
  sessionPrefsSet: "agent:session-prefs-set",
  // v14：跨会话用量账本（头像菜单「用量统计」→「全部会话」；main 只读扫描各工作区日志）。
  usageLedger: "agent:usage-ledger",
  // v25：Evolve 只读报告（设置页「进化」分区；main 现读 .agent/evolve）。
  evolveReport: "agent:evolve-report",
  evolveSetFrozen: "agent:evolve-set-frozen",
  // v45：人工激活一条过门经验（写 playbook active；拒绝原因随结果返回）。
  evolveActivate: "agent:evolve-activate",
  // v46：人工把一条 active 经验转 dormant（负证据/人工裁决出口）。
  evolveDormant: "agent:evolve-dormant",
  // v47：撤销一条全局经验（全局账 patch → dormant；跨 workspace 注入停用）。
  evolveGlobalRevoke: "agent:evolve-global-revoke",
  // v48：全局经验冻结开关（写/删全局 STOP；与 workspace STOP 分开）。
  evolveGlobalSetFrozen: "agent:evolve-global-set-frozen",
  // v49：恢复一条 dormant 全局经验（复核 ≥3 库证据；失败保持 dormant）。
  evolveGlobalActivate: "agent:evolve-global-activate",
  // v52：读 LSP 状态（只读、不起进程、不写授权）。
  lspStatus: "agent:lsp-status",
  orchestrationView: "agent:orchestration-view",
  orchestrationSubmit: "agent:orchestration-submit",
  orchestrationControl: "agent:orchestration-control",
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
  reportViewing: "agent:report-viewing",
  doctor: "agent:doctor",
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
  exportMemory: "agent:memory-export",
  exportDiagnostics: "agent:diagnostics-export",
  exportPreferences: "agent:preferences-export",
  importPreferences: "agent:preferences-import",
  resetPreferences: "agent:preferences-reset",
  listSkills: "agent:list-skills",
  skillBody: "agent:skill-body",
  submitFeedback: "agent:feedback-submit",
  listFeedback: "agent:feedback-list",
  setMessagePinned: "agent:message-pin-set",
  listMessagePins: "agent:message-pin-list",
  listProjects: "agent:projects-list",
  addProject: "agent:projects-add",
  relocateProject: "agent:projects-relocate",
  removeProject: "agent:projects-remove",
  setSessionPinned: "agent:session-pin",
  setSessionArchived: "agent:session-archive",
  sessionWorktree: "agent:session-worktree",
  worktreeClean: "agent:worktree-clean",
  worktreeDiff: "agent:worktree-diff",
  assignSessionProject: "agent:session-assign",
  deleteMemory: "agent:memory-delete",
  pluginDecide: "agent:plugin-decide",
  pluginUserConfigSet: "agent:plugin-user-config-set",
  marketplaceCatalog: "agent:marketplace-catalog",
  pluginPickLocalSource: "agent:plugin-pick-local-source",
  marketplacePluginImport: "agent:marketplace-plugin-import",
  marketplacePluginUpdate: "agent:marketplace-plugin-update",
  marketplacePluginCheckUpdate: "agent:marketplace-plugin-check-update",
  pluginConfigureInstalled: "agent:plugin-configure-installed",
  marketplacePluginInstall: "agent:marketplace-plugin-install",
  marketplacePluginInstallStatus: "agent:marketplace-plugin-install-status",
  marketplacePluginInstallCommit: "agent:marketplace-plugin-install-commit",
  marketplacePluginInstallCancel: "agent:marketplace-plugin-install-cancel",
  pluginSetEnabled: "agent:plugin-set-enabled",
  pluginUninstall: "agent:plugin-uninstall",
  pluginsInstalled: "agent:plugins-installed",
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
  importLicense: "agent:license-import",
  createProject: "agent:project-create",
  providerDiscover: "agent:provider-discover",
  providerSave: "agent:provider-save",
  providerCustomList: "agent:provider-custom-list",
  // 用户级 MCP 服务器管理（ZCode 独立管理对应面，2026-11-05）：配置读写 + 单台探测。
  mcpUserConfig: "agent:mcp-user-config",
  mcpUserSave: "agent:mcp-user-save",
  mcpUserProbe: "agent:mcp-user-probe",
  // 用户级 hooks（ZCode Hooks 管理对应面，2026-11-05）：配置读写。
  hooksUserConfig: "agent:hooks-user-config",
  hooksUserSave: "agent:hooks-user-save",
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
  subagentSettingsList: "agent:subagent-settings-list",
  subagentSettingsRead: "agent:subagent-settings-read",
  subagentSettingsSave: "agent:subagent-settings-save",
  subagentSettingsRemove: "agent:subagent-settings-remove",
  settingsPreviewMigration: "agent:settings-preview-migration",
  settingsApplyMigration: "agent:settings-apply-migration",
  idleTaskList: "agent:idle-task-list",
  idleTaskEnqueue: "agent:idle-task-enqueue",
  idleTaskUpdate: "agent:idle-task-update",
  backgroundTaskList: "agent:background-task-list",
  backgroundTaskStop: "agent:background-task-stop",
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

// 桥面域归属表（2026-11-12 · 对标 ADR 0010 的待办第 3 条）。
//
// 为什么有这张表：Claude Desktop 5.1231.2 的桥面是**按域命名空间**的
// （claude.web / claude.settings / claude.internal.ui … 约 24 个命名空间对象），
// 于是「这块能力属于哪个域」在那边是**可枚举的**。本仓的桥是单一扁平面，
// 165 条通道（156 invoke + 9 push）没有归属结构——通道名表本身已经长到
// 需要一张 156 条的手写名单来证明「每条都接真」（apps/desktop/tests/channels.test.ts）。
// ⇒ 这张表把「归属」变成**通道声明的一部分**，而不是测试里的一份平行名单。
//
// 完整性红线与 INVOKE_CHANNELS 同款：**映射类型** { [K in InvokeChannel]: ChannelDomain }
// ⇒ AgentApi 新增方法而这里不加行 ⇒ typecheck 红；删键同理。
// 通道**条数不变**（表长断言与 README 的 156 都不受影响）。
//
// 域的切法按「谁拥有这条能力」分，不按功能细分：域太多则名存实亡，太少则查不了。
export type ChannelDomain =
  | "run"
  | "session"
  | "project"
  | "provider"
  | "settings"
  | "plugin"
  | "skills"
  | "memory"
  | "automation"
  | "pane"
  | "app"
  | "integration"
  | "evolve"
  | "orchestration"
  | "usage"
  | "lsp"
  | "sidechat"
  | "feedback";

export const CHANNEL_DOMAIN_DESC: { [K in ChannelDomain]: string } = {
  run: "跑一轮与助手动作（发起、决策、澄清、计划、目标、取消、插话、压缩、建议下一条、卡片动作）",
  session: "会话生命周期与队列（建/开/改名/删/分叉/回滚、偏好、worktree、检索、日志、置顶、发送队列、导出）",
  project: "项目与工作区（项目增删改、模板与诊断、工作区上下文与文件浏览、路径动作、项目内检索、变更与 git 两闸）",
  provider: "供应商与密钥（读供应商信息、连接自检、自定义接口发现与存盘、密钥增删与状态）",
  settings: "设置与子代理设置（读写与重读、搜索设置、迁移预览与执行、子代理设置、偏好导入导出与复位）",
  plugin: "插件与市场（授权决策、用户配置、目录读数、来源选择、导入/更新/检查、安装 job、启停与卸载、已装清单）",
  skills: "技能（技能清单与技能正文）",
  memory: "记忆（删记忆、导出记忆）",
  automation: "自动化（定时任务快照与增删改与立即跑、闲时任务、后台命令）",
  pane: "窗格宿主（terminal、browser、preview 的起停与导航、浏览器授权与元素拾取、窗格弹出独立窗口）",
  app: "应用外壳与系统动作（状态、新手引导、能力在场性、协议版本、检查更新、外链、选目录/选文件、朗读、临时文件、快照还原、Finder 显示、附件缩略图、license 导入、诊断包导出）",
  integration: "外部集成（用户级 MCP 服务器管理、用户级 hooks 管理）",
  evolve: "进化账（只读报告、冻结、激活、沉睡、全局撤销/冻结/激活）",
  orchestration: "编排平台（只读视图、提交、控制）",
  usage: "用量账（跨会话用量统计）",
  lsp: "LSP（只读运行态）",
  sidechat: "侧聊（建、问、升为主会话、状态）",
  feedback: "反馈（用户提交反馈与反馈列表回读）",
};

/** invoke 通道的归属域（键集与 INVOKE_CHANNELS 完全一致：映射类型钉死，缺行 typecheck 红）。 */
export const CHANNEL_DOMAINS: { [K in InvokeChannel]: ChannelDomain } = {
  run: "run",
  decide: "run",
  submitClarify: "run",
  decidePlan: "run",
  setGoal: "run",
  runCancel: "run",
  runSteer: "run",
  compact: "run",
  suggestNext: "run",
  cardAction: "run",
  listSessions: "session",
  createSession: "session",
  openSession: "session",
  renameSession: "session",
  deleteSession: "session",
  forkSession: "session",
  revertTurn: "session",
  sessionPrefsSet: "session",
  sessionWorktree: "session",
  worktreeClean: "session",
  worktreeDiff: "session",
  assignSessionProject: "session",
  sessionLog: "session",
  sessionSearch: "session",
  setSessionPinned: "session",
  setSessionArchived: "session",
  queueGet: "session",
  queueSet: "session",
  setMessagePinned: "session",
  listMessagePins: "session",
  exportTranscript: "session",
  listProjects: "project",
  addProject: "project",
  relocateProject: "project",
  removeProject: "project",
  createProject: "project",
  touchProject: "project",
  projectTemplates: "project",
  projectCreateFromTemplate: "project",
  projectDiagnose: "project",
  projectExport: "project",
  setWorkspaceContext: "project",
  workspaceListDir: "project",
  workspaceReadText: "project",
  workspacePathAction: "project",
  workspaceSearch: "project",
  changeDiff: "project",
  gitStatus: "project",
  gitClone: "project",
  getProviderInfo: "provider",
  providerCheck: "provider",
  providerDiscover: "provider",
  providerSave: "provider",
  providerCustomList: "provider",
  providerKeySet: "provider",
  providerKeyDelete: "provider",
  providerKeyStatus: "provider",
  getSettings: "settings",
  setSettings: "settings",
  reloadSettings: "settings",
  searchSettingsGet: "settings",
  searchSettingsSave: "settings",
  searchSettingsTest: "settings",
  settingsPreviewMigration: "settings",
  settingsApplyMigration: "settings",
  subagentSettingsList: "settings",
  subagentSettingsRead: "settings",
  subagentSettingsSave: "settings",
  subagentSettingsRemove: "settings",
  exportPreferences: "settings",
  importPreferences: "settings",
  resetPreferences: "settings",
  pluginDecide: "plugin",
  pluginUserConfigSet: "plugin",
  marketplaceCatalog: "plugin",
  pluginPickLocalSource: "plugin",
  marketplacePluginImport: "plugin",
  marketplacePluginUpdate: "plugin",
  marketplacePluginCheckUpdate: "plugin",
  pluginConfigureInstalled: "plugin",
  marketplacePluginInstall: "plugin",
  marketplacePluginInstallStatus: "plugin",
  marketplacePluginInstallCommit: "plugin",
  marketplacePluginInstallCancel: "plugin",
  pluginSetEnabled: "plugin",
  pluginUninstall: "plugin",
  pluginsInstalled: "plugin",
  listSkills: "skills",
  skillBody: "skills",
  deleteMemory: "memory",
  exportMemory: "memory",
  scheduleSnapshot: "automation",
  scheduleUpsert: "automation",
  scheduleDelete: "automation",
  scheduleRunNow: "automation",
  idleTaskList: "automation",
  idleTaskEnqueue: "automation",
  idleTaskUpdate: "automation",
  backgroundTaskList: "automation",
  backgroundTaskStop: "automation",
  terminalStart: "pane",
  terminalWrite: "pane",
  terminalResize: "pane",
  terminalKill: "pane",
  browserOpen: "pane",
  browserBounds: "pane",
  browserNav: "pane",
  browserClose: "pane",
  browserClearData: "pane",
  browserSetAllowedHosts: "pane",
  browserPickElement: "pane",
  panePopout: "pane",
  previewStart: "pane",
  previewStop: "pane",
  previewStatus: "pane",
  getState: "app",
  getOnboarding: "app",
  capabilities: "app",
  protocolVersion: "app",
  checkUpdate: "app",
  openExternal: "app",
  pickDirectory: "app",
  pickFiles: "app",
  speakText: "app",
  stopSpeaking: "app",
  saveTempFile: "app",
  snapshotRestore: "app",
  revealInFinder: "app",
  attachmentThumb: "app",
  importLicense: "app",
  exportDiagnostics: "app",
  reportViewing: "app",
  doctor: "app",
  mcpUserConfig: "integration",
  mcpUserSave: "integration",
  mcpUserProbe: "integration",
  hooksUserConfig: "integration",
  hooksUserSave: "integration",
  evolveReport: "evolve",
  evolveSetFrozen: "evolve",
  evolveActivate: "evolve",
  evolveDormant: "evolve",
  evolveGlobalRevoke: "evolve",
  evolveGlobalSetFrozen: "evolve",
  evolveGlobalActivate: "evolve",
  orchestrationView: "orchestration",
  orchestrationSubmit: "orchestration",
  orchestrationControl: "orchestration",
  usageLedger: "usage",
  lspStatus: "lsp",
  sidechatCreate: "sidechat",
  sidechatAsk: "sidechat",
  sidechatPromote: "sidechat",
  sidechatState: "sidechat",
  submitFeedback: "feedback",
  listFeedback: "feedback",
};

/** push 通道的归属域。 */
export const PUSH_CHANNEL_DOMAINS: { [K in PushChannel]: ChannelDomain } = {
  onEvent: "run",
  onAsk: "run",
  onAskDone: "run",
  onTerminalData: "pane",
  onTerminalExit: "pane",
  onBrowserState: "pane",
  onPreviewState: "pane",
  onMenu: "app",
  onNotificationOpen: "app",
};

/** push 通道用到的域的说明（只有 push 真正用到的那几个域有词条 ⇒ Partial）。 */
export const PUSH_DOMAIN_DESC: Partial<{ [K in ChannelDomain]: string }> = {
  run: "运行事件流与提问往返（onEvent / onAsk / onAskDone）",
  pane: "窗格状态推送（terminal 数据与退出、browser 与 preview 状态）",
  app: "应用外壳推送（原生菜单命令、完成通知点击）",
};
