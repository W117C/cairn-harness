// M2e 扩展容器类型（§9.1–9.8 定稿）：一个容器装四类内容（skill / prompt / hook / agent），
// MCP 作为唯一外部协议。manifest = Claude Code plugin.json 超集：未知顶层字段忽略 + 警告不阻断。
// 命名空间（§9.3）：skill/prompt = /plugin-name:skill-name；agent 角色 = plugin-name:agent-name；
// MCP 工具 = mcp__plugin_<plugin>_<server>__<tool>；hook matcher 匹配插件 MCP 工具必须写 scoped 形态。

import type { UserConfigField } from "./manifest";

export type PluginScope = "user" | "project" | "loose";

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PreCompact"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop"
  | "SessionEnd";

/** handler 类型枚举：V1 只做 command；其余收下（schema 层）但运行跳过 + 警告。 */
export type HookHandlerType = "command" | "http" | "mcp_tool" | "prompt" | "agent";

export interface HookHandlerDef {
  type: HookHandlerType;
  /** shell form（string，经 shell 执行）或 exec form（string[]，直接 spawn，不经 shell）。 */
  command: string | string[];
  /** 秒；缺省 600（UserPromptSubmit 降 30）。 */
  timeout?: number;
}

export interface HookMatcherDef {
  /** 工具名 matcher（Pre/PostToolUse 系）；缺省 = 匹配全部。 */
  matcher?: string;
  /** §9.5 的 `if`：权限规则语法 best-effort 过滤（`Tool` 或 `Tool(<前缀>)`）。
   *  CC 原话「硬闸必须走权限系统」——本字段只决定**这条钩子跑不跑**，不放宽任何权限。 */
  if?: string;
  hooks: HookHandlerDef[];
}

/** hooks/hooks.json 或 manifest 内联 hooks 的形态。 */
export interface HooksFile {
  description?: string;
  hooks: Partial<Record<HookEventName, HookMatcherDef[]>>;
}

/** MCP server 配置（CC .mcp.json 形态）：command → stdio；url → http（type 可标 sse）。 */
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  type?: "stdio" | "http" | "sse";
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

/** .lsp.json（字段名向 CC 对齐，§9.8）：transport: socket 忽略 + 警告。 */
export interface LspServerConfig {
  command: string;
  args?: string[];
  extensionToLanguage?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
  startupTimeout?: number;
  restartOnCrash?: boolean;
  diagnostics?: { enabled?: boolean; maxPerFile?: number };
  transport?: string;
}

/** .lsp.json 的已知字段名单。写成「必须填满的 Record」而不是手抄字符串数组：
 *  少一个键或多一个键都在编译期红，于是这份名单与 LspServerConfig 不可能分家。
 *  discover 侧的「未知字段」判据用的就是它——过去那里另抄了 8 个字符串，今天恰好等价，
 *  明天给契约加一个字段就会把合法配置报成未知（本仓点名的第二事实源）。 */
const LSP_SERVER_FIELD_KEYS: Record<keyof LspServerConfig, true> = {
  command: true,
  args: true,
  extensionToLanguage: true,
  initializationOptions: true,
  startupTimeout: true,
  restartOnCrash: true,
  diagnostics: true,
  transport: true,
};

export const LSP_SERVER_FIELDS: ReadonlySet<string> = new Set(Object.keys(LSP_SERVER_FIELD_KEYS));

export interface LspConfigFile {
  /** 缺省 = 一个 LSP 也没配（零配置零进程）。解析侧一直按可选读；这里曾写必填 = 两份说法。 */
  servers?: Record<string, LspServerConfig>;
}

/** 解析后的插件（已发现未激活）。pending = 项目级插件等待信任。 */
export interface DiscoveredPlugin {
  name: string;
  scope: PluginScope;
  /** 插件根目录（绝对路径）。 */
  root: string;
  manifest: Record<string, unknown>;
  skills: SkillEntry[];
  commands: PromptCommandEntry[];
  agents: AgentRoleEntry[];
  hooks: LoadedHookDef[];
  mcp: { serverName: string; config: McpServerConfig }[];
  lsp: Record<string, LspServerConfig>;
  /** 未知顶层 manifest 字段（只警告不阻断）。 */
  unknownFields: string[];
  /** M2g：userConfig 敏感字段（值入 safeStorage，不落明文；§9.11-2）。 */
  userConfigFields: UserConfigField[];
  /** 解析期错误（单插件失败隔离：坏 manifest/坏 hook JSON 只影响自身）。 */
  errors: string[];
  /** 解析期警告（未知字段 / bare matcher / transport: socket 等）。 */
  warnings: string[];
  /** 项目级插件信任状态：trusted / pending / declined。user 级恒 trusted。 */
  trust: "trusted" | "pending" | "declined";
}

/** 散装 skill（无 manifest 的 foo/SKILL.md = 独立 skill，免包装加载）。
 *  E3（审查 P1-13）：带信任态——项目作用域不豁免（description 直进 system prompt = 注入面）；
 *  显式 looseRoots 与用户级安装恒 trusted；routingList 只收录 trusted。 */
export interface LooseSkill {
  name: string;
  root: string;
  entry: SkillEntry;
  trust: "trusted" | "pending" | "declined";
  /** 来自哪一个作用域根（第 438 页给 `cairn --plugins` 用：同一份 SKILL.md 摆在
   *  `<ws>/.agent/skills`（走信任门）和摆在 `M2E_LOOSE_SKILLS`（恒 trusted）下，
   *  状态不同而名字相同——只报名字就说不出「为什么这条要批、那条不用」。 */
  scope: PluginScope;
}

export interface SkillEntry {
  /** 插件名；散装 skill 为 null。 */
  plugin: string | null;
  name: string;
  description: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface PromptCommandEntry {
  plugin: string | null;
  name: string;
  description: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface AgentRoleEntry {
  plugin: string;
  name: string;
  description: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

/** 已装载的 hook 定义（含来源插件与其根目录，供去重与环境变量注入）。 */
export interface LoadedHookDef {
  plugin: string;
  /** 插件根目录（PLUGIN_ROOT 环境变量来源）。 */
  pluginRoot: string;
  event: HookEventName;
  matcher?: string;
  /** §9.5 的 `if`（从 HookMatcherDef 带到执行面；同组 handler 共享一条过滤）。 */
  if?: string;
  handler: HookHandlerDef;
  /** ${user_config.*} 禁入 shell-form hook：违规条目装载即拒绝（loaded=false + warning）。 */
  loaded: boolean;
}

/** 这一次扫描**实际**吃了哪几顶根（`null` = 这一顶没给，不是「给了空目录」）。
 *  由 `discoverPlugins` 用它自己传给 `scanScopeRoot` 的那几个变量填，调用方不许再算一遍：
 *  「扫了哪些根」和「扫到了什么」必须出自同一个决策点，否则列出来的根可以是猜的（第 438 页）。 */
export interface PluginScanRoots {
  userPluginsDir: string | null;
  projectPluginsDir: string | null;
  projectSkillsDir: string | null;
  looseRoots: string[];
  /** 外部声明式来源（opencode / pi）：只导入 skills、commands、agents，不含进程内代码插件。
   *  旧快照没带这一格 = 未记录（不是「没扫」）。 */
  foreignSources?: ForeignSource[];
}

/** 外部 harness 的声明式插件来源。各家的目录布局映射见 `foreign.ts` 的 FOREIGN_LAYOUTS。 */
export type ForeignSourceKind = "opencode" | "pi" | "codex" | "qoder" | "claude";

export interface ForeignSource {
  kind: ForeignSourceKind;
  /** 来源根（绝对路径），如 `<ws>/.opencode`、`<ws>/.pi`、`<ws>/.agents`、`<ws>/.qoder`、`<ws>/.claude`。 */
  root: string;
  scope: PluginScope;
  /** 合成插件名（决定 `/<name>:<command>` 与 skill 路由的命名空间）。 */
  name: string;
}

/** 加载清单（会话启动静态扫描产物；不新增事件类型，面板/脚本直接消费）。 */
export interface PluginsManifest {
  plugins: DiscoveredPlugin[];
  looseSkills: LooseSkill[];
  /** 可选：旧清单（测试夹具、落盘的快照）没这一格时读方按「未记录」处理，不当「没扫」。 */
  roots?: PluginScanRoots;
  /** 加载期错误聚合（单插件失败隔离的可见面：面板报错）。 */
  errors: { plugin: string; message: string }[];
  /** 加载期警告聚合。 */
  warnings: { plugin: string; message: string }[];
}

/** MCP server 运行状态（事件流投影消费：面板显示，无隐藏状态）。 */
export interface McpServerStatus {
  plugin: string;
  server: string;
  state: "connected" | "failed" | "untrusted" | "disabled";
  tools: string[];
  error?: string;
}
