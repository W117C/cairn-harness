// IPC 协议：main / preload / renderer 共享的类型（除协议版本常量外全部 type-only，跨层引用
// 不产生运行时依赖；版本常量是唯一运行时出口，SEMA §3.5/§12——src-execution-path 棘轮的
// 纯类型面豁免随 Phase 3 版本化撤名，执行路径由 tests/ipc-protocol-version.test.ts 供给）。
import type { AgentEvent, SessionRef, SessionView } from "../events";
import type { PermissionMode } from "../permissions";
import type { ToolName } from "../tools/base";
import type { SandboxStatus } from "./sandbox";
import type { AppSettings } from "./settings";
import type { OnboardingGroup } from "./onboarding-groups";
import type { ScheduleSnapshot } from "./scheduler";
import type { LicenseState } from "./license";
import type { UpdateCheckResult } from "./updater";
import type { AddProjectInput, ProjectRecord } from "./project-registry";
import type { ChangeDiffPayload } from "./change-diff";
import type { ListDirPayload, ReadTextPayload } from "./workspace-fs";
import type { SessionMetadataRecord } from "./session-metadata";
import type { RunAttachmentReference } from "./run-attachments";
import type { SessionQueueEntry } from "./sessions";
import type { ThinkingEffort } from "../providers/capabilities";
import type { ProviderInfo } from "./provider-runtime";
import type { CapabilityReadout } from "./doctor";
// v9：建议单发的结果形状事实源在 suggest-next（分类 + hint 的构造与失败面同源）；这里只转发类型。
import type { SuggestNextResult } from "./suggest-next";

export type { AgentEvent } from "../events";
export type { PermissionMode } from "../permissions";
export type { AppSettings } from "./settings";
export type { AddProjectInput, ProjectRecord } from "./project-registry";
export type { SessionMetadataRecord } from "./session-metadata";
export type { RunAttachmentReference } from "./run-attachments";
export type { SessionQueueEntry } from "./sessions";
export type { ThinkingEffort } from "../providers/capabilities";
export type { SuggestNextResult, SuggestNextReason } from "./suggest-next";
export type { ProviderInfo } from "./provider-runtime";
export type { CapabilityReadout } from "./doctor";
export type { ProjectDiagnosis, ProjectDiagnosisVerdict } from "./project-templates";
export type { DiscoveryProtocol } from "../providers/discovery";
export type { DiscoveredRow } from "../providers/provider-draft";
// 本地也要用这两个名字（`export type { X } from` 只做再导出，不进本文件的作用域）
import type { DiscoveryProtocol } from "../providers/discovery";
import type { DiscoveredRow } from "../providers/provider-draft";
import type { PreviewSnapshot } from "./project-preview";
// v12：导入诊断三态的形状事实源在 project-templates（判定与文案同源）；这里只转发类型。
import type { ProjectDiagnosis } from "./project-templates";
// v18：会话正文检索的结果类型（三态联合）。`import type` 编译期擦除 ⇒ 渲染层产物零运行时 import src。
import type { SessionSearchResult } from "./session-search";
export type { SessionSearchResult } from "./session-search";
import type { ProviderConnectionResult } from "./provider-connection";

// ---- SEMA §3.5/§12：IPC 协议版本化 ----
/** 协议兼容面唯一事实源：renderer 的期望版本经 vite define 构建期注入（App.tsx 挂载即比对
 *  主进程实况 `protocolVersion()`），失配 fail-closed 亮 fatal 面——老渲染层配新主进程（或反向）
 *  不许静默错位。改协议形状（AgentApi 增删/字段语义变）= bump 这里，并以 desktop-panel 提案
 *  走同一流水线（§3.5）。v4 = 变更审阅通道（changeDiff）；v5 = 窗格后端通道批（file/terminal/browser）；
 *  v6 = 产品第一批（模板建项 / 预览运行时 / 项目导出 / 连接自检）；
 *  v7 = 全量补全批（朗读 say / 路径动作 / 浏览器元素选择 / 浏览器清除数据）；
 *  v8 = 附件选择批（dialog 选文件——附件引用「选择文件…」）；
 *  v9 = 建议批（suggestNext——「Tab 想下一条」按上下文单发模型调用）；
 *  v10 = 能力在场性批（capabilities——搜索端点配没配，让「模型为什么少一把工具」上屏）；
 *  v11 = 主界面重做批（git 两闸 / 项目内模糊搜索 / 最近打开 / 粘贴落盘 / 快照还原 / Finder 显示）；
 *  v12 = 导入诊断批（projectDiagnose——导入已有文件夹先给三态诊断，ADR 0004 §4）；
 *  v13 = 记忆正文批（MemoryTopicPayload 增 body——「主题正文」快照面接通，§8 #15 销账）；
 *  v14 = 跨会话用量批（usageLedger——头像菜单「用量统计」的「全部会话」口径）；
 *  v15 = 会话日志批（sessionLog——错误条/命令面板「查看日志」的只读尾部）。
 *  v16 = 会话定位批（openSession 增可选 workspace——跨项目同名 id 必须开对转录）；
 *  v17 = 终端尺寸批（terminalResize——xterm 行列同步到真实 PTY）；
 *  v18 = 会话全文检索批（sessionSearch——搜**会话正文**而不是文件；结果是三态，
 *  「没量到 ≠ 没有」由类型层面分开，见 src/main/session-search.ts）。
 *  v19 = 指针分叉来源批（openSession 附 SessionRef + SessionView；会话 mutation/队列/注释
 *  增加可选 workspace——两个工作区同名 id 必须精确寻址，歧义拒绝）。 */
export const IPC_PROTOCOL_VERSION = 19;

// ---- v11：主界面重做批的载荷（git 读数 / 克隆 / 项目内搜索）----
/** git 在场读数：branch 为 null = detached HEAD（如实，不拿 "HEAD" 冒充分支名）。 */
export type GitStatusPayload = { ok: true; branch: string | null; dirtyFiles: number } | { ok: false; error: string };
/** 克隆结果：path = 落成的项目目录（成功后调用方登记为项目并切过去）。 */
export type GitCloneResult = { ok: true; path: string } | { ok: false; error: string };
/** 项目内搜索：hits 为 workspace 相对路径（正斜杠）；truncated = 扫描或命中超帽（不假装完整）。 */
export type WorkspaceSearchPayload =
  | { ok: true; hits: { path: string; kind: "file" | "directory" }[]; truncated: boolean }
  | { ok: false; error: string };

/** v14：跨会话用量账本（头像菜单「用量统计」→「全部会话」）。
 *  口径与渲染层 `usageSummary` 同源（core 纯函数 `usage-ledger.ts` 折叠，面板不再另算一套）：
 *  token 累加、缓存缺字段不计、工具步数与对话轮数只数主会话（worker 子流不计）。
 *  `sessions` / `workspaces` 是**有会话的**数量（不是已注册项目数——空项目不冒充工作量）；
 *  `skipped` = 读不了的会话文件数，`badLines` = 坏行数：统计不全时界面如实提示，不假装完整。 */
export interface UsageLedgerTotalsPayload {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usageCount: number;
  toolSteps: number;
  rounds: number;
}

export type UsageLedgerPayload =
  | {
      ok: true;
      totals: UsageLedgerTotalsPayload;
      sessions: number;
      workspaces: number;
      skipped: number;
      badLines: number;
    }
  | { ok: false; error: string };

/** v15：会话日志尾部（错误条/命令面板「查看日志」）。`path` 是**本会话日志的真实落点**
 *  （只经主进程按会话归属解析，不接受渲染层传任意路径）；`truncated` = 不是整份文件
 *  （字节窗口或行数截断），界面必须如实提示。 */
export type SessionLogPayload =
  | { ok: true; path: string; text: string; truncated: boolean; bytes: number; lines: number }
  | { ok: false; error: string };

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
/** 会话级 worktree 动作（§3.7 · G4）。`sessionId` 由调用方给——main 侧按会话归属解析工作区。 */
export type SessionWorktreeRequest =
  | { kind: "create"; sessionId: string; title?: string }
  | { kind: "merge"; sessionId: string }
  | { kind: "discard"; sessionId: string };

export interface SessionWorktreeResult {
  ok: boolean;
  /** 工作区绝对路径（create）。 */
  path?: string;
  branch?: string;
  /** symlink 降级警告（成功也可能有：链不上只是少一份共享，不阻断隔离）。 */
  warnings?: string[];
  /** merge 冲突：主 checkout 已被 abort 回干净态，清单交给人处理。 */
  conflict?: boolean;
  conflictedFiles?: string[];
  error?: string;
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
  /** 这张卡属于哪个会话。此前缺省 ⇒ 渲染层的单一 `ask` 态渲染"最后到达的那张卡"，
   *  跨会话时既串台又不敢按会话锁输入框（误锁别的会话）。缺省 = 归属未知（老载荷/headless
   *  路径本就没有会话面），渲染层按未知处理，**不许猜成当前会话**。 */
  sessionId?: string;
  /** 连拦降级提示（§2.2 双向断路器）：审批卡上明说"这一档最近连续被拒"并给一键降档。
   *  缺省 = 未达阈值（不是"没有这一档"）。 */
  tierWarning?: string;
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
  /** 审计 sidecar 字段；缺席 = 未记录，不能补成 epoch/0。 */
  viewedAt?: string;
  archivedAt?: string;
  idleSince?: string;
  resumeAttempts?: number;
  createdAt?: string;
  updatedAt?: string;
  /** 这条会话有自己的 git worktree（§3.7 · G4）。读侧由目录存在与否给真值，不另存状态。 */
  isolated?: boolean;
}

// ---- M2d 记忆快照（getState 透传：两层记忆 + 外部引用待批清单）----
export interface MemoryTopicPayload {
  topic: string;
  type: string;
  modified: string;
  bytes: number;
  /** v13：正文（frontmatter 已剥；无正文 = 空串）——「主题正文」面板此前是「待接」占位，
   *  快照只带索引与元信息（§8 #15）。正文读取本就在外部引用扫描里发生过，这里只是带上。
   *  展示口径：面板向人展示，不进模型上下文（与 index 同）。 */
  body: string;
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
  compact?(sessionId?: string, workspace?: string): Promise<CompactResponse>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onAsk(cb: (p: AskPayload) => void): () => void;
  /** 原生菜单命令（main → 渲染层）：id 见 apps/desktop/src/shared/menu-commands.ts。
   *  为什么走 push 而不是让主进程直接干活：菜单里绝大多数动作的真身在渲染层（要点亮浮层、
   *  要读「本轮是否在跑」、要移动焦点），主进程没有那些状态。 */
  onMenu(cb: (id: string) => void): () => void;
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
  /** v14：跨全部已登记工作区的用量账本（只读；按会话日志投影，不触发 openSession）。 */
  usageLedger(): Promise<UsageLedgerPayload>;
  /** v15：读该会话日志的尾部（只读；`tailLines` 缺省 400，上限 2000）。 */
  sessionLog(id: string, tailLines?: number): Promise<SessionLogPayload>;
  /** 新建会话；`workspace` = 该会话实际落点的规范工作区（缺省 = host 的 activeWorkspace）。
   *  回传归属：渲染层空屏直接发任务时 activeWorkspace 仍是 null，不回传就只能靠猜。 */
  createSession(name?: string): Promise<{ id: string; workspace: string }>;
  /** v19：`events` = 本地 raw；`session`/`view` = 来源视图（父前缀 + 物理行号）。
   *  workspace 显式给出会话归属（同名 id 跨项目时按它定位）；缺省 = host 自行解析，歧义拒绝。 */
  openSession(id: string, workspace?: string): Promise<{ events: AgentEvent[]; session: SessionRef; view: SessionView }>;
  /** 恢复闭环：读回 / 覆盖写该会话的发送队列 sidecar。队列不是 AgentEvent，不混入 JSONL；
   *  重启后由 renderer 读回并显式继续发送，仍走原有权限与沙箱链路。 */
  queueGet(sessionId: string, workspace?: string): Promise<{ items: SessionQueueEntry[] }>;
  queueSet(sessionId: string, items: SessionQueueEntry[], workspace?: string): Promise<{ ok: boolean; error?: string }>;
  renameSession(oldId: string, newName: string, workspace?: string): Promise<{ id: string }>;
  deleteSession(id: string, workspace?: string): Promise<{ currentSession: string | null }>;
  /** M8 分叉（v2.15 IPC 接线）：保留前 N 轮（含）→ 新会话 `<id>-f<N>`；源会话只读、字节不变。 */
  forkSession(sessionId: string, round: number, unique?: boolean, workspace?: string): Promise<{ ok: boolean; id?: string; error?: string }>;
  /** #7 文件级回滚（v2.16 IPC 接线）：把第 N 轮主会话改过的文件还原成该轮之前的原件（源自 D7 覆盖前快照）。
   *  只动主会话直写；worker 改动在各自 worktree（另有合并控制塔）。取不到原件 / 轮后又改过的逐条 manual 报出。 */
  revertTurn(sessionId: string, round: number, workspace?: string): Promise<{
    ok: boolean;
    error?: string;
    restored: string[];
    deleted: string[];
    manual: { path: string; why: string }[];
    failed: { path: string; error: string }[];
  }>;
  /** v4 变更审阅：某文件的逐 hunk 差异（D7 覆盖前快照 vs 当前文件）。snapshotId 缺席 = 新建。
   *  二进制/超帽/快照缺失都 fail-visible；路径越界即拒（审阅面不许成为任意读通道）。 */
  changeDiff(req: { path: string; snapshotId?: string }): Promise<ChangeDiffPayload>;
  /** v5 file 窗格：列 workspace 内一层目录（懒加载树；条目数帽截断如实标注）。 */
  /** 当前活动工作区上下文（desktop 专用，2026-10-17）：diff / 文件窗格 / 回滚 / 路径动作
   *  不再只认「最近一次 run 的工作区」——冷启动或切项目后还没跑过 run 也要能用。
   *  空串 = 清除上下文（回到旧口径）。 */
  setWorkspaceContext(path: string): Promise<{ ok: boolean; error?: string }>;
  workspaceListDir(relPath: string): Promise<ListDirPayload>;
  /** v5 file 窗格：读 workspace 内文本文件（单侧 512 KiB 帽；二进制拒）。 */
  workspaceReadText(relPath: string): Promise<ReadTextPayload>;
  /** v7 路径动作（§2.3 右键菜单）：relPath 相对当前工作区（越界即拒——同 workspace-fs 口径）。
   *  "abs" 只解析并回绝对路径（复制路径用）；"reveal" 在 Finder 中显示；"open" 用默认应用打开。 */
  workspacePathAction(relPath: string, action: "abs" | "reveal" | "open"): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** v7 朗读（§2.2 消息操作条 read aloud）：macOS 走系统 say；非 darwin fail-visible。
   *  重复调用先停上一条；进程随应用退出清理（will-quit）。 */
  speakText(text: string): Promise<{ ok: boolean; error?: string }>;
  /** v7 停止朗读（幂等）。 */
  stopSpeaking(): Promise<{ ok: boolean }>;
  /** v5 terminal 窗格（macOS）：起一个登录 shell（PTY 经 script(1)）；非 darwin fail-visible。 */
  terminalStart(): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** 用户输入 → shell stdin（未知 id 返回 false，不静默丢）。 */
  terminalWrite(id: string, data: string): Promise<boolean>;
  /** v17：同步真实 PTY 行列；非法尺寸、未知或已关闭终端返回 false。 */
  terminalResize(id: string, cols: number, rows: number): Promise<boolean>;
  /** 杀终端（幂等）。 */
  terminalKill(id: string): Promise<void>;
  /** v5 terminal 窗格推送：pty 输出（按 id 归因）。 */
  onTerminalData(cb: (e: { id: string; data: string }) => void): () => void;
  /** v5 terminal 窗格推送：终端退出（code null = 被信号杀）。 */
  onTerminalExit(cb: (e: { id: string; code: number | null }) => void): () => void;
  /** v5 browser 窗格：创建/导航某 id 的 WebContentsView（独立干净 profile；站点授权在渲染层先问）。 */
  browserOpen(id: string, url: string): Promise<{ ok: boolean; error?: string }>;
  /** v5 browser 窗格：容器矩形同步（窗口内像素；宽高 ≤0 = 隐藏视图）。 */
  browserBounds(id: string, rect: { x: number; y: number; width: number; height: number }): Promise<void>;
  /** v5 browser 窗格：后退/前进/刷新。 */
  browserNav(id: string, action: "back" | "forward" | "reload"): Promise<void>;
  /** v5 browser 窗格：销毁视图（窗格关闭时）。 */
  browserClose(id: string): Promise<void>;
  /** v7 browser 窗格：清除浏览数据（独立干净 profile 的存储；keepCookies=true 时保留 cookies）。 */
  browserClearData(id: string, opts: { keepCookies: boolean }): Promise<{ ok: boolean; error?: string }>;
  /** 渲染层授权清单变更（移除站点/忘记全部）同步到主进程：页内跳转/重定向的逐跳闸读这一份。 */
  browserSetAllowedHosts(hosts: string[]): Promise<{ ok: boolean }>;
  /** v7 browser 窗格：元素选择（§3.6 ⌘⇧S）——进入取色态，点击页面元素返回选择器/片段/URL；Esc 取消。
   *  取消是结果不是错误（ok:false + error 文案），界面如实呈现。 */
  browserPickElement(id: string): Promise<{ ok: boolean; selector?: string; snippet?: string; url?: string; error?: string }>;
  /** v5 窗格弹出：把某个窗格弹成独立窗口（#pane=<kind>&session=<id> 路由；事件推送已广播所有窗口）。 */
  panePopout(kind: string, sessionId?: string): Promise<{ ok: boolean; error?: string }>;
  /** v5 browser 窗格推送：导航状态（URL/标题/可否后退前进/加载中）。
   *  v7：`pick` 为元素选择的回程（页内 ⌘⇧S 由主进程 before-input-event 捕获——页面持有焦点时
   *  渲染层收不到按键；结果经本字段推回，与 browserPickElement 的返回同形）。 */
  onBrowserState(cb: (s: { id: string; url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; pick?: { ok: boolean; selector?: string; snippet?: string; url?: string; error?: string }; pending?: { url: string } }) => void): () => void;
  // ---- CX-01：真实项目注册表 + Session-plane 组织记录（必选桥；不是 renderer-local state）----
  /** v11：options.recentFirst = 最近打开序（lastOpenedAt 优先、旧记录退回 updatedAt）；
   *  includeRemoved = 含软删除（「最近打开」菜单列历史上用过的项目，一键重加）。缺省 = 旧行为。 */
  listProjects(options?: { includeRemoved?: boolean; recentFirst?: boolean }): Promise<ProjectRecord[]>;
  addProject(input: AddProjectInput): Promise<ProjectRecord>;
  removeProject(id: string): Promise<ProjectRecord>;
  // ---- v11：主界面重做批（七通道）----
  /** v11：读某项目的 git 在场信息（分支名 + 未提交条目数）——项目 chip 与快速建议的数据面。
   *  非仓库 / git 缺席分别可辨，一切失败进 ok:false（不抛）。 */
  gitStatus(path: string): Promise<GitStatusPayload>;
  /** v11：把远端仓库克隆到 parentDir（目录名取仓库名）；URL 限 https/ssh/git@ 白名单。
   *  目标已存在即拒（不合并不覆盖）；失败原文上屏（git 的报错本身是人话）。 */
  gitClone(req: { url: string; parentDir: string }): Promise<GitCloneResult>;
  /** v11：项目内文件模糊搜索（@ 引用补全）：命中 = workspace 相对路径 + 文件/目录；
   *  跳过 .git/node_modules 等，扫描与命中双帽截断如实标注。 */
  workspaceSearch(workspace: string, query: string): Promise<WorkspaceSearchPayload>;
  /** v18：**会话正文**全文检索（不是文件检索）——只读，扫该工作区下的会话 JSONL。
   *  结果是**三态**：`ok`（扫完了；空数组＝量过了没命中）／`partial`（预算用尽，命中为真但可能还有）／
   *  `unavailable`（**没量**——会话根读不到；绝不能被渲染成「没有匹配」）。
   *  可见语料 = 用户看得见的正文（用户消息 + 助手消息 + 按 callId 合并的流式片段）；模型自己的思考
   *  与工具载荷**不进语料**。逐工作区检索（工作区由主进程解析归属，渲染层不传路径）。 */
  sessionSearch(
    workspace: string,
    query: string,
    options?: { budgetBytes?: number; maxSessions?: number },
  ): Promise<SessionSearchResult>;
  /** v11：标记项目「最近打开」（打开会话 / 切换项目时调用）；未知 id 拒绝。 */
  touchProject(id: string): Promise<ProjectRecord>;
  /** v11：⌘V 粘贴素材落临时文件（截图等）；字节帽 20MB，返回路径此后走既有附件引用链。 */
  saveTempFile(req: { name: string; bytes: Uint8Array }): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** v11：把覆盖前快照还原回目标文件（检查器「撤销此文件改动」）——写前先给当前版本备份，
   *  撤销本身可再撤销；快照与路径配对校验与 changeDiff 完全同口径（越界即拒、防串文件）。
   *  成功后向该会话的事件流落一条 `file_restored`（sessionId 给了才落）——
   *  否则改动面还当这个文件没撤（行上仍写"修改"、徽标仍数着它、交付卡仍说"改动已验证"）。 */
  snapshotRestore(req: { path: string; snapshotId: string; sessionId?: string }): Promise<{ ok: boolean; error?: string }>;
  /** v11：在 Finder 中显示某绝对路径（项目右键菜单 / 项目外附件 chip 的落点）。只显示不打开。 */
  revealInFinder(path: string): Promise<{ ok: boolean; error?: string }>;
  /** 附件图片缩略图（2026-10-18 desktop 扩展）：仅图片扩展名、≤25MB；返回 40px PNG data URL。 */
  attachmentThumb(path: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  /** v2.16 用户反馈沉淀（赞/踩）：落 sidecar `feedback.jsonl`（append-only，不进事件流）。
   *  `rating:"none"` = 撤销（读时取最后一条生效）。未接线前界面只选中、不假提交。 */
  submitFeedback(req: { sessionId: string; eventId: number; rating: "up" | "down" | "none"; note?: string; workspace?: string }): Promise<{ ok: boolean; error?: string }>;
  /** 当前生效的反馈（按 eventId 去重、撤销的不返回）：界面据此点亮赞/踩。 */
  listFeedback(sessionId: string, workspace?: string): Promise<{ sessionId: string; eventId: number; rating: "up" | "down"; note?: string; at: string }[]>;
  /** 2026-10-20 消息置顶（规范 §3.11 操作条 pin）：sidecar `pins.jsonl`，append-only、不进事件流。
   *  `pinned:false` = 取消置顶（追加一条撤销行，读时取最后一条生效）。 */
  setMessagePinned(req: { sessionId: string; eventId: number; pinned: boolean; workspace?: string }): Promise<{ ok: boolean; error?: string }>;
  /** 某会话当前生效的置顶锚点（eventId 升序）。 */
  listMessagePins(sessionId: string): Promise<number[]>;
  /** 会话级 worktree 隔离（§3.7 · G4）：一条会话可以在自己的 git worktree 里跑，做完合并回来。
   *  三动作一个通道——它们共用同一条事实（磁盘上那棵树在不在），拆成三条只是把同一份状态抄三遍。 */
  sessionWorktree(req: SessionWorktreeRequest): Promise<SessionWorktreeResult>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<SessionMetadataRecord>;
  setSessionArchived(sessionId: string, archived: boolean): Promise<SessionMetadataRecord>;
  assignSessionProject(sessionId: string, projectId: string | null): Promise<SessionMetadataRecord>;
  // ---- M2g：preload 清账（六条通道全部桥接完成，`?` 按实际**收紧**为必选）----
  // 收紧理由：preload 现已无条件暴露这六条，optional 只会掩盖「桥接被删」的回归——
  // 收紧后谁删桥接行 typecheck 即红（静态兜住，不再靠运行时 typeof 探测）。
  /** M2d：记忆删除（仅用户经记忆面板；模型无删除权，§8.1.7）。 */
  deleteMemory(scope: "project" | "global", topic: string): Promise<{ ok: boolean; error?: string }>;
  /** M2e：插件信任卡决议（仅用户经插件面板；未信任不激活）。 */
  pluginDecide(plugin: string, trusted: boolean, workspace?: string): Promise<{ ok: boolean; error?: string }>;
  /** 写插件 userConfig（敏感字段走 safeStorage；值绝不回读给渲染层）。 */
  pluginUserConfigSet(plugin: string, values: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
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
  /** 能力在场性读数：搜索端点配没配、配在哪。**它回答的是「模型为什么少了一把工具」**——
   *  没配 `search.endpoint` 时 `web_search` 整族不注入（规格面与执行面同时摘），
   *  而这件事此前只存在于 CLI 的 --doctor 输出里，桌面端用户看到的是「模型说它不会搜」。 */
  capabilities(): Promise<CapabilityReadout>;
  // ---- v6：产品第一批（模板建项 / 预览运行时 / 项目导出 / 连接自检）----
  /** 模板目录：三条零依赖（展示网页 / 表单小工具 / 数据展示页）+ 一条 React/Vite。 */
  projectTemplates(): Promise<{ id: string; name: string; description: string; runKind: "static" | "vite" }[]>;
  /** 按模板建一个**能运行**的项目（模板文件 + .cairn/project.json；写盘失败自动回滚）。 */
  projectCreateFromTemplate(req: { name: string; templateId: string; parentDir?: string }): Promise<
    | { ok: true; name: string; path: string; parentDir: string; templateId: string }
    | { ok: false; reason: string; message: string }
  >;
  /** 起预览：static 走进程内静态服务；vite 先装依赖再起 dev server。失败分类见 PreviewSnapshot.stage。 */
  previewStart(projectPath: string): Promise<PreviewSnapshot>;
  /** 停预览（幂等）：进程组回收 + 静态服务关闭。 */
  previewStop(projectPath: string): Promise<PreviewSnapshot>;
  /** 当前预览状态（不触发启动）。 */
  previewStatus(projectPath: string): Promise<PreviewSnapshot>;
  /** v12 导入诊断：这个目录现在能不能受控预览（三态 supported / needs-info / unsupported + 原因 + 下一步）。
   *  只读判定，不写盘、不登记项目——诊断只提示不阻断（ADR 0004 §4：先给结果，再开始工作）。 */
  projectDiagnose(projectPath: string): Promise<ProjectDiagnosis>;
  /** 预览状态推送（准备/启动/就绪/失败/停止）。 */
  onPreviewState(cb: (s: PreviewSnapshot) => void): () => void;
  /** 导出项目到用户选的目录：排除 node_modules/dist/.git/.agent/.DS_Store，不覆盖已有目标。 */
  projectExport(projectPath: string): Promise<
    { ok: true; dest: string; copiedFiles: number } | { ok: false; error: string; cancelled?: boolean }
  >;
  /** 一次「检查连接」：GET 模型清单（不产生 token 费用），返回分类结果与下一步。 */
  providerCheck(provider: string): Promise<ProviderConnectionResult>;
  /** 导出当前对话为 Markdown 文件（2026-10-18）：原生保存面板（默认 Downloads），取消 ⇒ canceled。
   *  内容由渲染层生成（transcriptMarkdown），主进程只负责选路径与落盘。 */
  exportTranscript(markdown: string, suggestedName: string): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  /** 斜杠菜单列技能（2026-10-18）：当前工作区的 loose skills（调用名/描述/信任态）。
   *  workspace 缺省 = 当前工作区；桌面端显式传，避免切项目时的竞态。 */
  listSkills(workspace?: string): Promise<{
    skills: { invoke: string; description: string; trust: string }[];
    /** 容器插件的 prompt command（2026-10-18）：与技能同进斜杠补全；信任随插件。 */
    commands: { invoke: string; description: string; trust: string }[];
  }>;
  /** 技能指令正文（2026-10-18，§8 #15 待接收口）：设置页技能抽屉「读了再信任」。
   *  只读当前工作区 loose skill 的 SKILL.md 正文；超过 20000 字符截断并标 truncated。 */
  skillBody(name: string, workspace?: string): Promise<{ ok: boolean; body?: string; truncated?: boolean; path?: string; error?: string }>;
  /** M4-5：dialog 选目录（侧栏添加工作区表单「浏览…」的后端；M3 deferred 收口）。
   *  系统目录选择器（openDirectory，非模态）；取消/关窗 ⇒ null——文本手输兜底据此保留。 */
  pickDirectory(): Promise<string | null>;
  /** v8：dialog 选文件（附件引用「选择文件…」的后端）：系统文件选择器（openFile 多选，非模态）；
   *  取消/关窗 ⇒ null（空选不假报空数组）——手输路径兜底据此保留。 */
  pickFiles(): Promise<string[] | null>;
  /** v9：「Tab 想下一条」（业主 2026-10-16 裁 A②）：空输入框按 Tab → 按会话上下文单发一次模型调用，
   *  把「用户下一句最可能说的话」取回来填入输入框（只填不发）。单发不进会话流、不落 JSONL、不计量；
   *  失败按类分说（demo/no-key/empty/timeout/error + hint）——renderer 原样上屏，不静默凑字。 */
  suggestNext(input: { model: string | null; excerpt: string }): Promise<SuggestNextResult>;
  /** SEMA §3.5/§12：主进程实况协议版本（唯一事实源 = 本文件 IPC_PROTOCOL_VERSION）。
   *  renderer 挂载即比对构建期注入的期望版本，失配即 fatal——通道本身恒答得上来（版本化
   *  的第一格就是它自己），查询失败也按失配面处理。 */
  protocolVersion(): Promise<number>;
}
