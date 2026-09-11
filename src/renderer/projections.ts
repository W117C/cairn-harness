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

/** 会话 kind（M2g §10.8.4 序 4 / §7.5）：token 归因的维度。
 *  **不加事件字段**——kind 由「事件来自哪个会话文件」推导（§4.4.10 会话文件分离天然归因）。 */
export type SessionKind = "main" | "sidechat";

export interface TokenKindBreakdown {
  kind: SessionKind;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageCount: number;
  compactionCount: number;
}

export interface TokenProjection {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageCount: number;
  compactionCount: number;
  /** D11：压缩 ≥2 次提示开新会话。 */
  suggestNewSession: boolean;
  /** M2g：按会话 kind 分解（纯投影；总量 = 各分解之和）。单源投影 = 只含一项。 */
  byKind: TokenKindBreakdown[];
}

/** 单源投影（向后兼容：现有调用方只有一份事件流）。 */
export function projectTokenUsage(events: AgentEvent[]): TokenProjection {
  return projectTokenUsageByKind([{ kind: "main", events }]);
}

/** 多源投影（M2g §10.8.4 序 4）：按会话 kind 归因，总量 = 各分解之和。
 *  sidechat 的 usage 只进自己的分解项，**不计入 main 分解**（会话文件归属即归因依据）。 */
export function projectTokenUsageByKind(sources: { kind: SessionKind; events: AgentEvent[] }[]): TokenProjection {
  const byKind: TokenKindBreakdown[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let usageCount = 0;
  let compactionCount = 0;
  for (const src of sources) {
    let kIn = 0;
    let kOut = 0;
    let kUsage = 0;
    let kComp = 0;
    for (const e of src.events) {
      if (e.type === "usage") {
        kIn += e.inputTokens;
        kOut += e.outputTokens;
        kUsage++;
      } else if (e.type === "compaction") {
        kComp++;
      }
    }
    byKind.push({
      kind: src.kind,
      inputTokens: kIn,
      outputTokens: kOut,
      totalTokens: kIn + kOut,
      usageCount: kUsage,
      compactionCount: kComp,
    });
    inputTokens += kIn;
    outputTokens += kOut;
    usageCount += kUsage;
    compactionCount += kComp;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    usageCount,
    compactionCount,
    suggestNewSession: compactionCount >= 2,
    byKind,
  };
}

/** M2g：把「主会话单源投影」与「sidechat 聚合」合成一张按 kind 分解的投影。
 *  totalTokens = 各分解之和；main 分解保持主会话自身口径（sidechat 不并入 main）。 */
export function mergeTokenProjections(main: TokenProjection, sidechat: TokenKindBreakdown): TokenProjection {
  const mainBreak: TokenKindBreakdown = main.byKind[0] ?? {
    kind: "main",
    inputTokens: main.inputTokens,
    outputTokens: main.outputTokens,
    totalTokens: main.totalTokens,
    usageCount: main.usageCount,
    compactionCount: main.compactionCount,
  };
  const byKind: TokenKindBreakdown[] = [mainBreak, { ...sidechat, kind: "sidechat" }];
  const inputTokens = mainBreak.inputTokens + sidechat.inputTokens;
  const outputTokens = mainBreak.outputTokens + sidechat.outputTokens;
  const compactionCount = mainBreak.compactionCount + sidechat.compactionCount;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    usageCount: mainBreak.usageCount + sidechat.usageCount,
    compactionCount,
    suggestNewSession: compactionCount >= 2,
    byKind,
  };
}

/** 空 sidechat 分解（无旁路会话时的缺省值）。 */
export const EMPTY_SIDECHAT_USAGE: TokenKindBreakdown = {
  kind: "sidechat",
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  usageCount: 0,
  compactionCount: 0,
};

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

/** M2f：提升记录反向投影——主会话里带 origin 的 user_message → 源消息徽标定位。
 *  「源消息徽标由 origin 反向投影」即本函数：零新增事件类型，四字段全部来自 origin。 */
export interface PromoteBadge {
  /** 主流里的 user_message 事件号（1-based）。 */
  eventId: number;
  kind: string;
  sessionId: string;
  sourceEventIds: number[];
  note?: string;
  content: string;
}

export function projectPromoteBadges(events: AgentEvent[]): PromoteBadge[] {
  const out: PromoteBadge[] = [];
  events.forEach((e, i) => {
    if (e.type === "user_message" && e.origin) {
      out.push({
        eventId: i + 1,
        kind: e.origin.kind,
        sessionId: e.origin.session_id,
        sourceEventIds: [...e.origin.source_event_ids],
        ...(e.origin.note !== undefined ? { note: e.origin.note } : {}),
        content: e.content,
      });
    }
  });
  return out;
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
