// IPC 协议：main / preload / renderer 共享的类型（全部 type-only，跨层引用不产生运行时依赖）。
import type { AgentEvent } from "../events";
import type { PermissionMode } from "../permissions";
import type { ToolName } from "../tools/base";
import type { SandboxStatus } from "./sandbox";
import type { AppSettings } from "./settings";

export type { AgentEvent } from "../events";
export type { PermissionMode } from "../permissions";
export type { AppSettings } from "./settings";

export interface RunRequest {
  message: string;
  mode: PermissionMode;
}

export interface RunResponse {
  ok: boolean;
  error?: string;
}
export interface AskPayload {
  askId: string;
  tool: ToolName;
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
  reason: "user" | "timeout";
}
export interface StateResponse {
  sandbox: SandboxStatus;
}

/** M1d：手动 /compact 结果（压缩卡 payload 与 compaction-check 同源）。 */
export interface CompactResponse {
  ok: boolean;
  error?: string;
  cardPayload?: Record<string, unknown>;
}

/** 澄清表单提交值：key = 问题原文，value = 选中项或自由补充。 */
export type ClarifyAnswers = Record<string, string | string[]>;

/** M1e 会话列表条目（main → renderer）。 */
export interface SessionInfoPayload {
  id: string;
  mtimeMs: number;
  lines: number;
}

/** preload 暴露给 renderer 的 API（window.agent）。 */
export interface AgentApi {
  run(req: RunRequest & { sessionId?: string }): Promise<RunResponse>;
  decide(askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): Promise<boolean>;
  /** 澄清门：表单提交（card_action form_submit），值挂回原 tool_use id。 */
  submitClarify(callId: string, answers: ClarifyAnswers): Promise<boolean>;
  /** 方案门：批准 / 拒绝当前 plan（card_action plan_decide）。 */
  decidePlan(approved: boolean, callId?: string): Promise<boolean>;
  /** M1d 手动压缩入口（M1e 起 preload 暴露：token 面板按钮）。 */
  compact?(): Promise<CompactResponse>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onAsk(cb: (p: AskPayload) => void): () => void;
  onAskDone(cb: (p: AskOutcomePayload) => void): () => void;
  getState(): Promise<StateResponse>;
  /** M1e：Provider 只读信息（设置页展示）。 */
  getProviderInfo(): Promise<{ provider: string; model: string }>;
  // ---- M1e：settings（布局 + 设置页持久化，主进程 app data）----
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  // ---- M1e：会话列表（JSONL 即会话）----
  listSessions(): Promise<SessionInfoPayload[]>;
  createSession(name?: string): Promise<{ id: string }>;
  openSession(id: string): Promise<{ events: AgentEvent[] }>;
  renameSession(oldId: string, newName: string): Promise<{ id: string }>;
  deleteSession(id: string): Promise<{ currentSession: string | null }>;
}
