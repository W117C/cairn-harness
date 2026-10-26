import type { AgentMode } from "../events";

export type AgentRuntimeStatus =
  | "starting"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export interface AgentSpawnSpec {
  threadId?: string;
  task: string;
  mode: "read" | "write";
  role?: string;
  model?: string;
  maxTurns?: number;
  resources?: string[];
  fence?: string;
}

export interface AgentMessage {
  id: string;
  threadId: string;
  runId?: string;
  kind: "progress" | "report";
  text: string;
  ts: number;
}

export interface AgentRecord {
  id: string;
  workspace: string;
  sessionId: string;
  task: string;
  mode: AgentMode;
  role?: string;
  status: AgentRuntimeStatus;
  currentRunId?: string;
  runIds: string[];
  fence?: string;
  summary?: string;
  createdAt: number;
  updatedAt: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AgentReceipt {
  ok: boolean;
  threadId: string;
  runId?: string;
  messageId?: string;
  duplicate: boolean;
  reason?: string;
}

export interface AgentWaitOptions {
  timeoutMs?: number;
}

export interface AgentWaitResult {
  rows: AgentRecord[];
  timedOut: string[];
  unknown: string[];
}

export interface AgentRuntime {
  spawn(spec: AgentSpawnSpec): Promise<AgentRecord>;
  send(id: string, message: { id: string; text: string }, fence?: string): Promise<AgentReceipt>;
  wait(ids: readonly string[], opts?: AgentWaitOptions): Promise<AgentWaitResult>;
  resume(id: string, fence: string): Promise<AgentRecord>;
  close(id: string): Promise<AgentReceipt>;
  list(): Promise<AgentRecord[]>;
  cancel(ids: readonly string[]): Promise<AgentReceipt[]>;
}

