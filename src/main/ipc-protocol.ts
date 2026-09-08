// IPC 协议：main / preload / renderer 共享的类型（全部 type-only，跨层引用不产生运行时依赖）。
import type { AgentEvent } from "../events";
import type { PermissionMode } from "../permissions";
import type { ToolName } from "../tools/base";
import type { SandboxStatus } from "./sandbox";

export type { AgentEvent } from "../events";
export type { PermissionMode } from "../permissions";

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
}
export interface AskOutcomePayload {
  askId: string;
  outcome: "approved" | "rejected";
  reason: "user" | "timeout";
}
export interface StateResponse {
  sandbox: SandboxStatus;
}

/** preload 暴露给 renderer 的 API（window.agent）。 */
export interface AgentApi {
  run(req: RunRequest): Promise<RunResponse>;
  decide(askId: string, approved: boolean): Promise<boolean>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onAsk(cb: (p: AskPayload) => void): () => void;
  onAskDone(cb: (p: AskOutcomePayload) => void): () => void;
  getState(): Promise<StateResponse>;
}
