// 面板投影纯函数（§10.2：面板内容 100% 事件流订阅投影，无第二事实源）。
// approvals = 待批卡聚合（活审批通道，重启后 pending 必空——与重启前一致）；
// token = usage 事件累计 + 压缩次数（D11：多次压缩建议开新会话）；
// git = diff 卡列表（write 工具动作聚合，M1 不做 git 控制塔）。
// M2d memory = 会话内 remember 调用审计（写入即事件 §8.1.4：tool_call/tool_result 投影）。
// electron/DOM-free，panels-check（headless）与 vitest 共用。
import type { AgentEvent } from "../events";

export interface AskLike {
  askId: string;
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
  risk?: string;
  sentAt?: number;
  resolved?: "approved" | "rejected";
}

export interface TokenProjection {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageCount: number;
  compactionCount: number;
  /** D11：压缩 ≥2 次提示开新会话。 */
  suggestNewSession: boolean;
}

export function projectTokenUsage(events: AgentEvent[]): TokenProjection {
  let inputTokens = 0;
  let outputTokens = 0;
  let usageCount = 0;
  let compactionCount = 0;
  for (const e of events) {
    if (e.type === "usage") {
      inputTokens += e.inputTokens;
      outputTokens += e.outputTokens;
      usageCount++;
    } else if (e.type === "compaction") {
      compactionCount++;
    }
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    usageCount,
    compactionCount,
    suggestNewSession: compactionCount >= 2,
  };
}

export interface DiffCardProjection {
  /** tool_call id（键）。 */
  id: string;
  path: string;
  content: string;
  ok: boolean | null;
}

/** diff 卡列表：tool_call(write_file) + 配对 tool_result 状态（事件流聚合，M1 无 base_commit diff）。 */
export function projectDiffCards(events: AgentEvent[]): DiffCardProjection[] {
  const calls = new Map<string, { path: string; content: string }>();
  const results = new Map<string, boolean>();
  for (const e of events) {
    if (e.type === "tool_call" && e.name === "write_file") {
      calls.set(e.id, {
        path: typeof e.args.path === "string" ? e.args.path : "(未知路径)",
        content: typeof e.args.content === "string" ? e.args.content : JSON.stringify(e.args),
      });
    } else if (e.type === "tool_result") {
      results.set(e.callId, e.ok);
    }
  }
  return [...calls.entries()].map(([id, c]) => ({ id, path: c.path, content: c.content, ok: results.get(id) ?? null }));
}

/** 待批卡聚合：未 resolved 的审批（活通道投影；重启后 pending 必空 = 与重启前一致）。 */
export function pendingApprovals(asks: AskLike[]): AskLike[] {
  return asks.filter((a) => !a.resolved);
}

/** M2d：会话内 remember 调用审计（写入即事件投影；scope/kind/topic 取自调用参数）。 */
export interface MemoryWriteProjection {
  callId: string;
  scope: string;
  kind: string;
  topic: string;
  ok: boolean | null;
  output: string;
}

export function projectMemoryWrites(events: AgentEvent[]): MemoryWriteProjection[] {
  const calls = new Map<string, Record<string, unknown>>();
  const results = new Map<string, { ok: boolean; output: string }>();
  for (const e of events) {
    if (e.type === "tool_call" && e.name === "remember") {
      calls.set(e.id, e.args);
    } else if (e.type === "tool_result" && calls.has(e.callId)) {
      results.set(e.callId, { ok: e.ok, output: e.output });
    }
  }
  return [...calls.entries()].map(([callId, args]) => {
    const r = results.get(callId);
    return {
      callId,
      scope: typeof args.scope === "string" ? args.scope : "?",
      kind: typeof args.kind === "string" ? args.kind : "?",
      topic: typeof args.topic === "string" ? args.topic : "-",
      ok: r ? r.ok : null,
      output: r ? r.output : "",
    };
  });
}
