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
        // M3a §4.4.10：带 agent_id 的 usage 归属 worker 分解，不并入会话 kind 桶（归因不重复计）
        if ("agent_id" in e && typeof e.agent_id === "string" && e.agent_id !== "") continue;
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

// ---- M3b 合并控制塔投影（§4.3 / §4.4.5 / §4.5 评审闭环；纯事件流投影，零私有状态）----

/** 合并控制塔列：每个 write worker 一张合并卡（分支/基线/diff 快照/findings/评论/收尾态）。 */
export interface MergeTowerColumn {
  agent_id: string;
  task: string;
  worktree: string;
  base_commit: string;
  branch: string;
  /** worker 当前状态（agent_status 最新一拍）。 */
  status: string;
  /** diff 快照（按序累积；最新 = 最后一份——评审闭环 v1→v2）。 */
  diffs: { version: number; stat: string; patch: string }[];
  /** 最新安全报告（agent_id 归因的最新一份 security_report；off 模式缺省 null）。 */
  report: {
    mode: string;
    findings: { severity: string; path: string; line: number; title: string; description: string; ruleId: string; suggestion?: string }[];
    summary: { total: number; critical: number; high: number };
    llmReviewed: boolean;
  } | null;
  /** 行级评论（diff_comment 事件投影）。 */
  comments: { path: string; line: number; body: string; ts?: number }[];
  /** 收尾态：merged / rejected / conflict / gate-confirm / cleaned / null（待决策）。 */
  outcome: "merged" | "rejected" | "conflict" | "gate-confirm" | "cleaned" | null;
  outcomeText: string;
}

const SEV_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** unified diff 行解析（纯函数）：每行带新文件侧行号（hunk @@ -a,b +c,d @@ 推导；上下文/新增行有行号，删除行 null）。
 *  评审闭环行级评论的行号凭据：diff 卡第 i 行 → 文件真实行号（diff_comment.line）。 */
export interface PatchLine {
  text: string;
  /** 新文件侧 1-based 行号；文件头（---/+++/diff index）与删除行为 null。 */
  newLine: number | null;
}

export function parsePatchLines(patch: string): PatchLine[] {
  const out: PatchLine[] = [];
  let newLine: number | null = null;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      out.push({ text: raw, newLine: null });
      continue;
    }
    if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      out.push({ text: raw, newLine: null });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ text: raw, newLine });
      if (newLine !== null) newLine++;
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({ text: raw, newLine: null });
      continue;
    }
    out.push({ text: raw, newLine });
    if (newLine !== null) newLine++;
  }
  return out;
}

/** 合并控制塔投影（纯函数）：agent_spawned(mode=write) → 列；diff tool_result（子流）→ diff 快照；
 *  security_report(agent_id) → findings；diff_comment → 评论；merge-/wt-cleanup- tool_result → 收尾态。 */
export function projectMergeTower(events: AgentEvent[]): MergeTowerColumn[] {
  const cols = new Map<string, MergeTowerColumn>();
  for (const e of events) {
    if (e.type === "agent_spawned" && e.mode === "write") {
      cols.set(e.agent_id, {
        agent_id: e.agent_id,
        task: e.task,
        worktree: e.worktree ?? "",
        base_commit: e.base_commit ?? "",
        branch: "agent/*-" + e.agent_id,
        status: "running",
        diffs: [],
        report: null,
        comments: [],
        outcome: null,
        outcomeText: "",
      });
    }
  }
  for (const e of events) {
    if (e.type === "tool_result" && typeof e.callId === "string" && e.callId.startsWith("diff-")) {
      const agentId = e.callId.slice("diff-".length);
      const col = cols.get(agentId);
      if (!col) continue;
      const m = /## stat\n([\s\S]*?)(?:\n## patch\n([\s\S]*?))?(?:\n## LLM 审查\n[\s\S]*)?$/.exec(e.output);
      col.diffs.push({ version: col.diffs.length + 1, stat: (m?.[1] ?? "").trim(), patch: (m?.[2] ?? "").trim() });
    } else if (e.type === "security_report" && e.agent_id !== undefined) {
      const col = cols.get(e.agent_id);
      if (!col) continue;
      col.report = {
        mode: e.mode,
        findings: e.findings.map((f) => ({
          severity: f.severity,
          path: f.path,
          line: f.line,
          title: f.title,
          description: f.description,
          ruleId: f.ruleId,
          ...(f.suggestion !== undefined ? { suggestion: f.suggestion } : {}),
        })),
        summary: { total: e.summary.total, critical: e.summary.bySeverity.critical ?? 0, high: e.summary.bySeverity.high ?? 0 },
        llmReviewed: e.llm_reviewed === true,
      };
    } else if (e.type === "diff_comment") {
      const col = cols.get(e.agent_id);
      if (col) col.comments.push({ path: e.path, line: e.line, body: e.body, ...(e.ts !== undefined ? { ts: e.ts } : {}) });
    } else if (e.type === "tool_result" && typeof e.callId === "string" && (e.callId.startsWith("merge-") || e.callId.startsWith("wt-cleanup-"))) {
      const agentId = e.callId.replace(/^(merge|wt-cleanup)-/, "");
      const col = cols.get(agentId);
      if (!col) continue;
      const out = e.output;
      if (out.startsWith("[merged]")) {
        col.outcome = "merged";
        col.outcomeText = out;
      } else if (out.startsWith("[rejected]")) {
        col.outcome = "rejected";
        col.outcomeText = out;
      } else if (out.startsWith("[conflict]")) {
        col.outcome = "conflict";
        col.outcomeText = out;
      } else if (out.startsWith("[gate]")) {
        col.outcome = "gate-confirm";
        col.outcomeText = out;
      } else if (out.startsWith("[worktree]") && col.outcome === null) {
        col.outcome = "cleaned";
        col.outcomeText = out;
      }
    } else if (e.type === "agent_status") {
      const c = cols.get(e.agent_id);
      if (c) c.status = e.status; // F10（审查）：守卫替代非空断言
    }
  }
  // findings 按严重度降序（合并卡红标显示面）
  for (const col of cols.values()) {
    col.report?.findings.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0));
  }
  return [...cols.values()];
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

// ---- M3a §4.4.10：usage 按 agent 分解（纯投影；总量 = main + Σworker） ----

export interface AgentTokenBreakdown {
  agent_id: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageCount: number;
}

export interface TokenByAgentProjection {
  /** 主 loop 口径（不带 agent_id 的 usage）。 */
  main: { inputTokens: number; outputTokens: number; totalTokens: number; usageCount: number };
  agents: AgentTokenBreakdown[];
  /** 会话总量 = main + Σworker（独立口径聚合，§4.4.10）。 */
  totalTokens: number;
}

export function projectTokenUsageByAgent(events: AgentEvent[]): TokenByAgentProjection {
  const main = { inputTokens: 0, outputTokens: 0, usageCount: 0 };
  const byAgent = new Map<string, AgentTokenBreakdown>();
  for (const e of events) {
    if (e.type !== "usage") continue;
    const agentId = "agent_id" in e && typeof e.agent_id === "string" ? e.agent_id : "";
    if (agentId === "") {
      main.inputTokens += e.inputTokens;
      main.outputTokens += e.outputTokens;
      main.usageCount++;
      continue;
    }
    const cur = byAgent.get(agentId) ?? { agent_id: agentId, inputTokens: 0, outputTokens: 0, totalTokens: 0, usageCount: 0 };
    cur.inputTokens += e.inputTokens;
    cur.outputTokens += e.outputTokens;
    cur.totalTokens = cur.inputTokens + cur.outputTokens;
    cur.usageCount++;
    byAgent.set(agentId, cur);
  }
  const agents = [...byAgent.values()];
  const agentsTotal = agents.reduce((n, a) => n + a.totalTokens, 0);
  return {
    main: { ...main, totalTokens: main.inputTokens + main.outputTokens },
    agents,
    totalTokens: main.inputTokens + main.outputTokens + agentsTotal,
  };
}

// ---- M3a §10.2 agents 面板投影（每 worker 一列，零事件流外私有状态） ----

export type AgentPanelStatus = "running" | "waiting_approval" | "waiting_input" | "done" | "failed" | "cancelled";

export interface AgentColumn {
  agent_id: string;
  mode: string;
  task: string;
  /** 血缘：spawn tool_call 的主流事件 id（分组树键）。 */
  parent_event_id: number;
  permission_mode: string;
  tier_warning?: string;
  max_turns: number;
  status: AgentPanelStatus;
  reason?: string;
  /** 子流最近事件（compact 行，≤3 条）。 */
  recent: string[];
  /** 该 agent 的 usage 合计（usage 事件投影）。 */
  usage: { inputTokens: number; outputTokens: number };
  /** 工具调用计数（tool_stats 投影）。 */
  toolStats: Record<string, number>;
  /** 待批审批（approval_requested 无对应 resolved）。 */
  pendingApproval: { id: string; tool: string; risk: string } | null;
  /** 终态报告（agent_result.summary / artifacts.report）。 */
  report?: string;
  statusFailed?: boolean;
  /** 时长（ms；ts 纯事件投影：spawn.ts → 终态 ts；未终态为 null）。 */
  durationMs: number | null;
  startedTs?: number;
}

export function projectAgentPanel(events: AgentEvent[]): AgentColumn[] {
  interface Acc {
    col: AgentColumn;
    resolved: Set<string>;
    lastResult?: Extract<AgentEvent, { type: "agent_result" }>;
  }
  const order: string[] = [];
  const acc = new Map<string, Acc>();
  const get = (agentId: string): Acc => {
    const existing = acc.get(agentId);
    if (existing) return existing;
    // agent_status 等先于 agent_spawned 到达（理论不可达）时容错建列
    const fresh: Acc = {
      col: {
        agent_id: agentId,
        mode: "?",
        task: "",
        parent_event_id: 0,
        permission_mode: "?",
        max_turns: 0,
        status: "running",
        recent: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        toolStats: {},
        pendingApproval: null,
        durationMs: null,
      },
      resolved: new Set<string>(),
    };
    acc.set(agentId, fresh);
    order.push(agentId);
    return fresh;
  };
  for (const e of events) {
    if (e.type === "agent_spawned") {
      const a = get(e.agent_id);
      a.col = {
        ...a.col,
        agent_id: e.agent_id,
        mode: e.mode,
        task: e.task,
        parent_event_id: e.parent_event_id,
        permission_mode: e.permission_mode,
        ...(e.tier_warning ? { tier_warning: e.tier_warning } : {}),
        max_turns: e.max_turns,
        startedTs: e.ts,
      };
    } else if (e.type === "agent_status") {
      const a = get(e.agent_id);
      a.col = {
        ...a.col,
        status: e.status,
        ...(e.reason !== undefined ? { reason: e.reason } : {}),
        ...(e.ts !== undefined && (e.status === "done" || e.status === "failed" || e.status === "cancelled") && a.col.startedTs !== undefined
          ? { durationMs: e.ts - a.col.startedTs }
          : {}),
      };
    } else if (e.type === "agent_message") {
      const a = get(e.agent_id);
      a.col.recent = [...a.col.recent, (e.kind === "report" ? "[报告] " : "[进展] ") + e.text.slice(0, 120)].slice(-3);
    } else if (e.type === "tool_call" && typeof e.agent_id === "string" && e.agent_id !== "") {
      const a = get(e.agent_id);
      a.col.recent = [...a.col.recent, "🔧 " + e.name].slice(-3);
      a.col.toolStats = { ...a.col.toolStats, [e.name]: (a.col.toolStats[e.name] ?? 0) + 1 };
    } else if (e.type === "usage" && typeof e.agent_id === "string" && e.agent_id !== "") {
      const a = get(e.agent_id);
      a.col.usage = {
        inputTokens: a.col.usage.inputTokens + e.inputTokens,
        outputTokens: a.col.usage.outputTokens + e.outputTokens,
      };
    } else if (e.type === "approval_requested" && typeof e.agent_id === "string" && e.agent_id !== "") {
      const a = get(e.agent_id);
      a.col.pendingApproval = { id: e.id, tool: e.tool, risk: e.risk };
      a.col.status = "waiting_approval";
    } else if (e.type === "approval_resolved" && typeof e.agent_id === "string" && e.agent_id !== "") {
      const a = get(e.agent_id);
      a.resolved.add(e.id);
      a.col.pendingApproval = null;
      if (e.decision === "approved") a.col.status = "running";
    } else if (e.type === "agent_result") {
      const a = get(e.agent_id);
      a.lastResult = e;
      a.col = {
        ...a.col,
        ...(e.summary !== "" ? { report: e.summary } : {}),
        statusFailed: e.status === "failed",
        ...(e.reason !== undefined ? { reason: e.reason } : {}),
      };
    }
  }
  // 待批审批以 resolved 集复核（resolved 可能后于 status 更新）
  for (const a of acc.values()) {
    if (a.col.pendingApproval && a.resolved.has(a.col.pendingApproval.id)) a.col.pendingApproval = null;
  }
  // F10（审查）：守卫替代非空断言——order 里的 id 缺 acc 条目（数据异常）时跳过而不是抛
  return order.flatMap((id) => {
    const a = acc.get(id);
    return a ? [a.col] : [];
  });
}

// ---- M4a 定时任务投影辅助（renderer 纯函数，不 import main/scheduler——避免 node:fs 进 bundle）----

// ---- G10（审查 P3）：面板与卡片各写一份的公共映射，抽唯一实现防漂移 ----

/** stat 文本的首个文件路径（行级评论 path 的缺省凭据）。 */
export function firstPathOfStat(stat: string): string | null {
  for (const line of stat.split("\n")) {
    if (line.includes("|")) return line.trim().split(/\s+\|/)[0]?.replace(/"/g, "") ?? null;
  }
  return null;
}

/** agent 状态 → Badge variant/label（agents 面板列与指挥卡共用；两份手写映射已实际漂移）。 */
export function agentStatusBadge(status: string): { variant: "default" | "secondary" | "destructive" | "outline"; label: string } {
  if (status === "done") return { variant: "default", label: "done" };
  if (status === "failed") return { variant: "destructive", label: "failed" };
  if (status === "cancelled") return { variant: "outline", label: "cancelled" };
  if (status === "waiting_approval" || status === "waiting_input") return { variant: "destructive", label: status };
  return { variant: "secondary", label: status };
}

/** skipped 原因 → UI hover 中文标签（休眠/重叠/并发满/过期，Claude Desktop 同款，§12.2.6）。 */
export function skipReasonLabel(reason: string | undefined): string {
  switch (reason) {
    case "too-old":
      return "过期：错过触发超出 7 天回看窗口，仅补最近一次";
    case "catch-up-skip":
      return "休眠错过：catchUp=skip 档不补跑，已对齐下次触发";
    case "overlap":
      return "重叠：该任务上一次运行仍在进行中";
    case "concurrency-cap":
      return "并发满：同时运行的定时会话已达上限";
    case "interrupted（重启后无终态记录；V1 不自动重试，可 run_now 兜底）":
      return "中断：应用重启时该次运行无终态记录（V1 不自动重试）";
    default:
      return reason ?? "";
  }
}

/** 运行历史六态筛选值（§12.1 运行历史；cancelled 为保留态——V1 无取消入口）。 */
export const HISTORY_STATES = ["all", "queued", "running", "succeeded", "failed", "skipped", "cancelled"] as const;
export type HistoryFilter = (typeof HISTORY_STATES)[number];

// ---- R1a 抽屉面板投影（右栏五面板的唯一数据源；渲染层不再持有任何演示数据）----

export interface PanelFileEntry {
  path: string;
  /** 新增行数（write_file 内容行数；edit_file 不在 projectDiffCards 口径内，故恒 0 删除行）。 */
  added: number;
  removed: number;
  created: boolean;
  ok: boolean | null;
}

export interface PanelTreeGroup {
  /** 目录（workspace 相对）；根目录文件为空串。 */
  dir: string;
  files: PanelFileEntry[];
}

export interface PanelTerminalEntry {
  callId: string;
  command: string;
  /** null = 结果未回（运行中）。 */
  ok: boolean | null;
  output: string;
}

export interface PanelMergeEntry {
  agent_id: string;
  task: string;
  status: string;
  outcome: string | null;
}

export interface PanelData {
  workspace: { name: string; path: string } | null;
  files: PanelFileEntry[];
  tree: PanelTreeGroup[];
  terminal: PanelTerminalEntry[];
  merge: PanelMergeEntry[];
}

/** 空面板数据（无事件流时的缺省：四块全空，渲染层据此走空态而非演示数据）。 */
export const EMPTY_PANEL_DATA: PanelData = { workspace: null, files: [], tree: [], terminal: [], merge: [] };

/** 右栏面板数据：审阅/文件树共用 diff 投影（同一事实源，两处不得各算各的），
 *  终端取 run_shell 调用-结果配对，合并取 write worker 列。 */
export function projectPanelData(events: AgentEvent[], workspace: string | null): PanelData {
  const files: PanelFileEntry[] = projectDiffCards(events).map((d) => ({
    path: d.path,
    added: d.content === "" ? 0 : d.content.split("\n").length,
    removed: 0,
    created: true,
    ok: d.ok,
  }));
  const groups = new Map<string, PanelFileEntry[]>();
  for (const f of files) {
    const cut = f.path.lastIndexOf("/");
    const dir = cut < 0 ? "" : f.path.slice(0, cut);
    const bucket = groups.get(dir) ?? [];
    bucket.push(f);
    groups.set(dir, bucket);
  }
  const terminal: PanelTerminalEntry[] = [];
  const seen = new Map<string, PanelTerminalEntry>();
  for (const e of events) {
    if (e.type === "tool_call" && e.name === "run_shell") {
      const row: PanelTerminalEntry = {
        callId: e.id,
        command: typeof e.args.command === "string" ? e.args.command : "",
        ok: null,
        output: "",
      };
      terminal.push(row);
      seen.set(e.id, row);
    } else if (e.type === "tool_result" && seen.has(e.callId)) {
      const row = seen.get(e.callId)!;
      row.ok = e.ok;
      row.output = e.output;
    }
  }
  const trimmed = typeof workspace === "string" ? workspace.trim() : "";
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return {
    workspace: trimmed === "" ? null : { name: name === "" ? trimmed : name, path: trimmed },
    files,
    tree: [...groups.entries()].map(([dir, fs]) => ({ dir, files: fs })),
    terminal,
    merge: projectMergeTower(events).map((c) => ({ agent_id: c.agent_id, task: c.task, status: c.status, outcome: c.outcome })),
  };
}
