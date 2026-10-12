// IPC 协议：main / preload / renderer 共享的类型（除协议版本常量外全部 type-only，跨层引用
// 不产生运行时依赖；版本常量是唯一运行时出口，SEMA §3.5/§12——src-execution-path 棘轮的
// 纯类型面豁免随 Phase 3 版本化撤名，执行路径由 tests/ipc-protocol-version.test.ts 供给）。
import type { AgentEvent } from "../events";
import type { PermissionMode } from "../permissions";
import type { ToolName } from "../tools/base";
import type { SandboxStatus } from "./sandbox";
import type { AppSettings } from "./settings";
import type { OnboardingGroup } from "./onboarding-groups";
import type { ScheduleSnapshot } from "./scheduler";
import type { LicenseState } from "./license";
import type { UpdateCheckResult } from "./updater";
import type { AddProjectInput, ProjectRecord } from "./project-registry";
import type { SessionMetadataRecord } from "./session-metadata";
import type { RunAttachmentReference } from "./run-attachments";
import type { ThinkingEffort } from "../providers/capabilities";
import type { ProviderInfo } from "./provider-runtime";

export type { AgentEvent } from "../events";
export type { PermissionMode } from "../permissions";
export type { AppSettings } from "./settings";
export type { AddProjectInput, ProjectRecord } from "./project-registry";
export type { SessionMetadataRecord } from "./session-metadata";
export type { RunAttachmentReference } from "./run-attachments";
export type { ThinkingEffort } from "../providers/capabilities";
export type { ProviderInfo } from "./provider-runtime";
export type { DiscoveryProtocol } from "../providers/discovery";
export type { DiscoveredRow } from "../providers/provider-draft";
// 本地也要用这两个名字（`export type { X } from` 只做再导出，不进本文件的作用域）
import type { DiscoveryProtocol } from "../providers/discovery";
import type { DiscoveredRow } from "../providers/provider-draft";

// ---- SEMA §3.5/§12：IPC 协议版本化 ----
/** 协议兼容面唯一事实源：renderer 的期望版本经 vite define 构建期注入（App.tsx 挂载即比对
 *  主进程实况 `protocolVersion()`），失配 fail-closed 亮 fatal 面——老渲染层配新主进程（或反向）
 *  不许静默错位。改协议形状（AgentApi 增删/字段语义变）= bump 这里，并以 desktop-panel 提案
 *  走同一流水线（§3.5）。 */
export const IPC_PROTOCOL_VERSION = 1;

/** S7：探测结果（表单据此渲染那张可勾选的表）。 */
export type ProviderDiscoverPayload =
  | {
      ok: true;
      rows: DiscoveredRow[];
      truncated: number;
      /** 目录与探测都没给、**必须用户自己填**的字段名（界面据此把输入框标出来）。 */
      missing: string[];
      warnings: string[];
      catalogOrigin: "snapshot" | "cache" | "live";
      catalogNote?: string;
      matchedProviderId?: string;
    }
  | { ok: false; reason: string; message: string };

export interface ProviderSaveRequest {
  providerId: string;
  label?: string;
  protocol: DiscoveryProtocol;
  baseURL: string;
  apiKeyEnv: string;
  allowLocalEndpoint?: boolean;
  models: {
    id: string;
    model?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
    price?: { inputPerMTok?: number; outputPerMTok?: number; cacheReadPerMTok?: number; cacheWritePerMTok?: number };
    reasoningEfforts?: string[];
  }[];
  /** 有值就顺手存进 safeStorage（加密落盘，明文不落）。 */
  keyValue?: string;
}

export type ProviderSaveResult =
  | { ok: true; path: string; providers: string[]; installed: number; warnings: string[] }
  | { ok: false; error: string; problems?: { kind: string; where: string; message: string }[] };

export interface RunRequest {
  message: string;
  mode: PermissionMode;
  /** M1e 会话模式：带上它 run 才追加到既有会话 JSONL（缺省 = 临时日志 + 每轮 rm 的旧行为）。 */
  sessionId?: string;
  /** SoL-Pi P-1 步骤 3：本次 run 的工作区（绝对路径）；缺省按 overrides → env → settings → 内置靶子解析。 */
  workspace?: string;
  /** Stable registry id (for example openai-standard). Provider wire model names are settings-only legacy input. */
  model?: string;
  /** Provider capability gate. All current adapters only accept off until thinking is wired to the wire. */
  thinking?: ThinkingEffort;
  /** Local references only. Main validates canonical location/type before the run starts. */
  attachments?: RunAttachmentReference[];
}

export interface RunResponse {
  ok: boolean;
  error?: string;
  /** Present only when validated references were consumed as path context. */
  attachmentCount?: number;
}
export interface AskPayload {
  askId: string;
  // M2d：remember 等运行时注入工具不进 ToolName 静态键域，审批卡只作展示串
  tool: ToolName | string;
  args: Record<string, unknown>;
  /** M1c：送审原因与风险注记（审批卡必显，§11.1）。 */
  reason?: string;
  risk?: "none" | "low" | "medium" | "high" | "critical";
  riskReasons?: string[];
  /** M1e：审批送达时间戳（徽标 ≤1s 验收用，Date.now 毫秒）；缺省 = 未标注。 */
  sentAt?: number;
}
export interface AskOutcomePayload {
  askId: string;
  outcome: "approved" | "rejected";
  /** M4a 增 "unattended"：无人值守 fail-closed 自动拒绝（§12.2.4）。 */
  reason: "user" | "timeout" | "unattended";
}
export interface StateResponse {
  sandbox: SandboxStatus;
  /** M2d：记忆两层快照（缺省 = 尚未初始化）。 */
  memory?: MemorySnapshot;
  /** M2e：插件面板快照（加载清单 + 信任 + MCP 状态；缺省 = 无插件运行时）。 */
  plugins?: import("../agent/plugins").PluginPanelSnapshot;
  /** M2f：辅助对话面板快照（sidechat 会话清单 + 已提升记录；缺省 = 无会话目录）。 */
  sidechat?: SidechatPanelSnapshot;
  /** M3b：孤儿 worktree 扫描（§4.4.9 只列不自动删；git 面板「可清理」列表数据源）。 */
  worktree?: { orphans: string[] };
  /** M4a：定时任务面板快照（任务定义 + 运行历史投影 + 并发计数；journal/会话纯投影）。 */
  schedule?: ScheduleSnapshot;
  /** M4b：license 状态（valid/expired/inactive/invalid；inactive → 引导横幅，§2.2）。 */
  license?: LicenseState;
  /** M4b：provider key 状态面（safeStorage 可用性 + 已存 provider 清单 + env 并存提示；不含 key 值）。 */
  providerKeys?: { available: boolean; stored: string[]; envActive: boolean; envProviders: string[] };
  /** M4b：关于信息（版本展示；关于/更新组与引导第 4 步消费）。 */
  about?: { version: string };
}

/** M2f sidechat 面板快照（纯投影：会话清单 + 最近消息 + 已提升记录）。
 *  M2g：每会话带 usage 聚合（token 面板按会话 kind 分解的数据源；§10.8.4 序 4）。 */
export interface SidechatPanelSnapshot {
  parentSessionId: string | null;
  sessions: {
    id: string;
    parentId: string | null;
    lines: number;
    mtimeMs: number;
    messages: { eventId: number; role: "user" | "assistant"; text: string }[];
    /** M2g：该旁路会话的 usage 聚合（从自身 JSONL 投影，sidechat kind 的归因依据）。 */
    usage: { inputTokens: number; outputTokens: number; usageCount: number; compactionCount: number };
  }[];
  /** 已提升记录（主会话 user_message.origin 反向投影）。 */
  promoted: { eventId: number; sessionId: string; sourceEventIds: number[]; note?: string }[];
}

/** M1d：手动 /compact 结果（压缩卡 payload 与 compaction-check 同源）。 */
export interface CompactResponse {
  ok: boolean;
  error?: string;
  cardPayload?: Record<string, unknown>;
}

/** 澄清表单提交值：key = 问题原文，value = 选中项或自由补充。 */
export type ClarifyAnswers = Record<string, string | string[]>;

/** M1e 会话列表条目（main → renderer）。CX-01 的 sidecar 字段仅在确有 metadata 时出现，
 *  因而老会话保持旧 payload 形状，不被列表读取凭空补造。 */
export interface SessionInfoPayload {
  id: string;
  mtimeMs: number;
  lines: number;
  origin?: "scheduled";
  automationId?: string;
  automationName?: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ---- M2d 记忆快照（getState 透传：两层记忆 + 外部引用待批清单）----
export interface MemoryTopicPayload {
  topic: string;
  type: string;
  modified: string;
  bytes: number;
}
export interface MemoryLayerSnapshot {
  /** 该层根目录（展示用绝对路径——面板向人展示，不进模型上下文）。 */
  path: string;
  /** MEMORY.md 索引全文（null = 尚无索引）。 */
  index: string | null;
  topics: MemoryTopicPayload[];
  /** 已发现但未批准/未拒绝的工作区外 @path 引用。 */
  pendingExternalRefs: string[];
}
export interface MemorySnapshot {
  project: MemoryLayerSnapshot;
  global: MemoryLayerSnapshot;
}

/** preload 暴露给 renderer 的 API（window.agent）。 */
export interface AgentApi {
  run(req: RunRequest & { sessionId?: string }): Promise<RunResponse>;
  decide(askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): Promise<boolean>;
  /** 澄清门：表单提交（card_action form_submit），值挂回原 tool_use id。 */
  submitClarify(callId: string, answers: ClarifyAnswers): Promise<boolean>;
  /** 方案门：批准 / 拒绝当前 plan（card_action plan_decide）。 */
  decidePlan(approved: boolean, callId?: string): Promise<boolean>;
  /** goal 模式：给某个会话设定/改设目标（轮次上限 + 美元上限），或 `clear:true` 清除。
   *  不发 = 会话不自动续跑。`clamped` 回条 = 入参被钳制过的字段点名（不静默改用户的预算）。
   *  v2.16：`pause:true` 挂起（停自动续跑、目标仍武装）、`resume:true` 恢复（只清挂起位，
   *  不重置窗口/轮次）。挂起 ≠ 清除：清除落 `goal_stopped`（终态、不可复活）。 */
  setGoal(req: { sessionId?: string; objective?: string; maxTurns?: number; maxUsd?: number; clear?: boolean; pause?: boolean; resume?: boolean }): Promise<{ ok: boolean; error?: string; clamped?: string[] }>;
  /** P3（审查）：取消当前交互 run——信号沿 runLoop 轮界/门等待/长驻工具透传。
   *  M3-5：补可选 sessionId 走会话级取消（kernel-host cancel(sessionId)，T2 per-session controller）；
   *  缺省无参 = 兼容旧调用（host 侧 fail-visible：{ok:false,"会话不在运行"}）。 */
  runCancel(sessionId?: string): Promise<{ ok: boolean; error?: string }>;
  /** M1d 手动压缩入口（M1e 起 preload 暴露：token 面板按钮）。 */
  compact?(): Promise<CompactResponse>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onAsk(cb: (p: AskPayload) => void): () => void;
  onAskDone(cb: (p: AskOutcomePayload) => void): () => void;
  getState(): Promise<StateResponse>;
  /** Provider/model/capability catalog derived from the same registry used by workers. */
  getProviderInfo(): Promise<ProviderInfo>;
  /** §13 新手引导覆盖面（只读，唯一事实源在主进程 `onboarding-groups.ts`）。
   *  必选而非 `?`：删掉桥接行就 typecheck 红，不用运行时 typeof 自证。 */
  getOnboarding(): Promise<OnboardingGroup[]>;
  // ---- M1e：settings（布局 + 设置页持久化，主进程 app data）----
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  // ---- M1e：会话列表（JSONL 即会话）----
  listSessions(): Promise<SessionInfoPayload[]>;
  createSession(name?: string): Promise<{ id: string }>;
  openSession(id: string): Promise<{ events: AgentEvent[] }>;
  renameSession(oldId: string, newName: string): Promise<{ id: string }>;
  deleteSession(id: string): Promise<{ currentSession: string | null }>;
  /** M8 分叉（v2.15 IPC 接线）：保留前 N 轮（含）→ 新会话 `<id>-f<N>`；源会话只读、字节不变。 */
  forkSession(sessionId: string, round: number): Promise<{ ok: boolean; id?: string; error?: string }>;
  /** #7 文件级回滚（v2.16 IPC 接线）：把第 N 轮主会话改过的文件还原成该轮之前的原件（源自 D7 覆盖前快照）。
   *  只动主会话直写；worker 改动在各自 worktree（另有合并控制塔）。取不到原件 / 轮后又改过的逐条 manual 报出。 */
  revertTurn(sessionId: string, round: number): Promise<{
    ok: boolean;
    error?: string;
    restored: string[];
    deleted: string[];
    manual: { path: string; why: string }[];
    failed: { path: string; error: string }[];
  }>;
  // ---- CX-01：真实项目注册表 + Session-plane 组织记录（必选桥；不是 renderer-local state）----
  listProjects(): Promise<ProjectRecord[]>;
  addProject(input: AddProjectInput): Promise<ProjectRecord>;
  removeProject(id: string): Promise<ProjectRecord>;
  /** v2.16 用户反馈沉淀（赞/踩）：落 sidecar `feedback.jsonl`（append-only，不进事件流）。
   *  `rating:"none"` = 撤销（读时取最后一条生效）。未接线前界面只选中、不假提交。 */
  submitFeedback(req: { sessionId: string; eventId: number; rating: "up" | "down" | "none"; note?: string }): Promise<{ ok: boolean; error?: string }>;
  /** 当前生效的反馈（按 eventId 去重、撤销的不返回）：界面据此点亮赞/踩。 */
  listFeedback(sessionId: string): Promise<{ sessionId: string; eventId: number; rating: "up" | "down"; note?: string; at: string }[]>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<SessionMetadataRecord>;
  setSessionArchived(sessionId: string, archived: boolean): Promise<SessionMetadataRecord>;
  assignSessionProject(sessionId: string, projectId: string | null): Promise<SessionMetadataRecord>;
  // ---- M2g：preload 清账（六条通道全部桥接完成，`?` 按实际**收紧**为必选）----
  // 收紧理由：preload 现已无条件暴露这六条，optional 只会掩盖「桥接被删」的回归——
  // 收紧后谁删桥接行 typecheck 即红（静态兜住，不再靠运行时 typeof 探测）。
  /** M2d：记忆删除（仅用户经记忆面板；模型无删除权，§8.1.7）。 */
  deleteMemory(scope: "project" | "global", topic: string): Promise<{ ok: boolean; error?: string }>;
  /** M2e：插件信任卡决议（仅用户经插件面板；未信任不激活）。 */
  pluginDecide(plugin: string, trusted: boolean): Promise<{ ok: boolean; error?: string }>;
  /** M2f：辅助对话（sidechat）+ /promote。 */
  sidechatCreate(parentSessionId: string, name?: string): Promise<{ id: string }>;
  sidechatAsk(sidechatId: string, message: string, parentSessionId?: string): Promise<{ ok: boolean; error?: string; events?: AgentEvent[] }>;
  /** /promote：把 sidechat 结论提升进主会话（渲染为主会话一条 user_message + origin）。 */
  sidechatPromote(req: {
    sidechatId: string;
    parentSessionId: string;
    sourceEventIds: number[];
    note?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  sidechatState(parentSessionId?: string): Promise<SidechatPanelSnapshot>;
  /** M3a：card_action 回写协议（§10.3）——worker 审批应答 / agent 取消的唯一事件流入口。 */
  cardAction(req: {
    cardId: string;
    sourceEventId: number;
    cardType: string;
    action: string;
    payload?: Record<string, unknown>;
    scope?: "once" | "session_kind" | "always";
    targetAgentId?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  /** M4a：定时任务（§12.2.6 schedule 面板）：快照 / 创建或更新 / 删除 / 手动触发。
   *  upsert 的 form 缺省 true（表单四 kind 白名单）；既有任务的 enabled 开关等数据模型更新传 false。 */
  scheduleSnapshot(): Promise<ScheduleSnapshot>;
  scheduleUpsert(def: unknown, form?: boolean): Promise<{ ok: boolean; error?: string }>;
  scheduleDelete(id: string): Promise<{ ok: boolean; error?: string }>;
  scheduleRunNow(id: string): Promise<{ ok: boolean; error?: string }>;
  // ---- M4b：BYOK key（safeStorage）/ license / 更新检查（§2.1/§2.2/§2.3）----
  /** M4b §2.1：保存 provider key 到钥匙串（safeStorage；不可用 = fail-closed 拒绝，不落明文）。 */
  providerKeySet(provider: string, key: string): Promise<{ ok: boolean; error?: string }>;
  /** M4b §2.1：删除已存 provider key。 */
  providerKeyDelete(provider: string): Promise<{ ok: boolean; error?: string }>;
  /** M4b §2.1：key 状态面（不含 key 值）：safeStorage 可用性 / 已存 provider / env 并存提示。 */
  providerKeyStatus(): Promise<{ available: boolean; stored: string[]; envActive: boolean; envProviders: string[] }>;
  // ---- S7：自定义接口（BYO 端点）——「填地址+钥匙 → 拉取模型 → 勾选 → 存盘」三段 ----
  /** 探测一个地址有哪些模型，并用本地目录补窗口/价格。**不改任何文件**（「拉取」必须零副作用）。 */
  providerDiscover(req: {
    baseURL: string;
    protocol?: DiscoveryProtocol;
    keyEnv: string;
    /** 表单里刚输入、还没落盘的钥匙（一次性；不给则读环境变量）。 */
    keyValue?: string;
    allowLocal?: boolean;
  }): Promise<ProviderDiscoverPayload>;
  /** ③：按项目名建一个同名文件夹，登记成工作区并交回 canonical 路径（用户实测要求
   *  「先建一个以项目名命名的文件夹，再进入项目」）。 */
  createProject(req: { name: string; parentDir?: string }): Promise<
    | { ok: true; name: string; path: string }
    | { ok: false; reason: string; message: string }
  >;
  /** 把一家写进工作区 `.agent/providers.json`（按 id upsert，别的家原样保留）；
   *  给了 `keyValue` 就顺手存进 safeStorage（存失败则整件事失败，不写半个配置）。 */
  providerSave(req: ProviderSaveRequest): Promise<ProviderSaveResult>;
  /** M4b §2.3：轻量更新检查（未配置 / 网络失败 / 已最新 / 有新版 全显式态）。 */
  checkUpdate(): Promise<UpdateCheckResult>;
  /** M4b §2.3：打开下载页（shell.openExternal，仅 http(s) 白名单——防 manifest 注入协议）。 */
  openExternal(url: string): Promise<{ ok: boolean; error?: string }>;
  /** M4-5：dialog 选目录（侧栏添加工作区表单「浏览…」的后端；M3 deferred 收口）。
   *  系统目录选择器（openDirectory，非模态）；取消/关窗 ⇒ null——文本手输兜底据此保留。 */
  pickDirectory(): Promise<string | null>;
  /** SEMA §3.5/§12：主进程实况协议版本（唯一事实源 = 本文件 IPC_PROTOCOL_VERSION）。
   *  renderer 挂载即比对构建期注入的期望版本，失配即 fatal——通道本身恒答得上来（版本化
   *  的第一格就是它自己），查询失败也按失配面处理。 */
  protocolVersion(): Promise<number>;
}
