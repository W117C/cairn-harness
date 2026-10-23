// 窗格投影（纯函数，判卷面）：方案窗格 / 任务窗格的数据面。
// 全部从主会话事件流的原始事件投影（worker 子流事件直接按 agent_id 归组——projectStream 会滤掉，
// 本层不经过它）。diff 窗格复用既有 turnDelivery 投影，不在此重复。
import type { AgentEvent } from "../../../../../src/events";
import { turnChanges } from "../projections";

// ── 窗格集合与路由（唯一事实源；PaneDock 与独立窗口路由共用）────────

import { PANE_META, PANE_OPENABLE, type PaneKind } from "../pane-registry";
// 窗格登记表（类型/标签表/重排/⌘\ 选窗格）已搬到顶层 pane-registry.ts（Phase 2 · 批 2.3）：
// state/ 不许 import components/，而那份是数据与纯函数、不是组件。导出面照旧从本文件转出。
export { PANE_META, PANE_OPENABLE, lastOpenedPane, movePane, type PaneKind } from "../pane-registry";

/** 独立窗口路由：`#pane=<kind>[&session=<id>]` → 目标窗格；非该形状（含未知 kind）返回 null
 *  （主窗口模式——不猜、不部分匹配）。 */
export function parsePaneHash(hash: string): { kind: PaneKind; sessionId: string | null } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  const params = new URLSearchParams(raw);
  const kind = params.get("pane");
  if (kind === null || !Object.hasOwn(PANE_META, kind)) return null;
  const session = params.get("session");
  return { kind: kind as PaneKind, sessionId: session === null || session === "" ? null : session };
}

// ── 方案窗格 ──────────────────────────────────────────────────────

export interface PlanPaneItem {
  callId: string;
  goal: string;
  /** 计划中的文件动作（action/path/summary 逐字来自 plan_proposed）。 */
  files: { action: string; path: string; summary: string }[];
  approach?: string;
  verify?: { lint?: string; test?: string };
  /** 决议状态：待决 / 已批准 / 已拒绝（plan_approved 配对；缺席 = 待决）。 */
  state: "pending" | "approved" | "rejected";
  ts?: number;
}

/** 全部方案（提交顺序）+ 决议配对。plan_approved 按 callId 收口；无对应提案的决议忽略（不编条目）。 */
export function projectPlans(events: readonly AgentEvent[]): PlanPaneItem[] {
  const out: PlanPaneItem[] = [];
  const byCall = new Map<string, PlanPaneItem>();
  for (const e of events) {
    if (e.type === "plan_proposed") {
      const plan = (e as { plan: { goal: string; files: { action: string; path: string; summary: string }[]; approach?: string; verify?: { lint?: string; test?: string } } }).plan;
      const item: PlanPaneItem = {
        callId: (e as { callId: string }).callId,
        goal: plan.goal,
        files: plan.files.map((f) => ({ action: f.action, path: f.path, summary: f.summary })),
        state: "pending",
        ...(plan.approach !== undefined ? { approach: plan.approach } : {}),
        ...(plan.verify !== undefined ? { verify: plan.verify } : {}),
        ...((e as { ts?: number }).ts !== undefined ? { ts: (e as { ts?: number }).ts } : {}),
      };
      out.push(item);
      byCall.set(item.callId, item);
    } else if (e.type === "plan_approved") {
      const callId = (e as { callId: string }).callId;
      const item = byCall.get(callId);
      if (item !== undefined) item.state = (e as { approved: boolean }).approved ? "approved" : "rejected";
    }
  }
  return out;
}

// ── 任务窗格（多 agent 状态）─────────────────────────────────────

export type WorkerVerified = "verified" | "failed" | "stale" | "absent";

export interface WorkerPaneItem {
  agentId: string;
  mode: string;
  task: string;
  role?: string;
  status: "running" | "waiting_approval" | "waiting_input" | "done" | "failed" | "cancelled";
  reason?: string;
  /** 进度行（agent_message.kind=progress，按到达顺序）。 */
  progress: string[];
  startedTs?: number;
  endedTs?: number;
  durationSec?: number;
  filesChanged?: string[];
  /** worker「代码能跑」的凭据（四态）；缺席 = 本轮没改过文件没有这张券。 */
  verified?: WorkerVerified;
  /** 表价花费（USD）；**缺席 = 价格不可知**，消费者不许当 0。 */
  spentUsd?: number;
  summary?: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** agent_result 在会话事件流里的 1-based 行号（card_action 的 sourceEventId；worker 合并/拒绝用）。 */
  resultEventId?: number;
}

/** worker 四事件（spawned/status/message/result）按 agent_id 归组。spawned 缺席的孤儿事件忽略
 *  （没有派活记录就没有可信的任务面——不编一个空任务）。终态时长 = ended − started（缺一不算）。 */
/** worker 合并/拒绝的 card_action 请求（sourceEventId 必须是 agent_result 的行号；
 *  主进程的 merge/reject 路由按 targetAgentId 找 mergeOwners，cardId 只作审计标识）。 */
export function workerCardAction(agentId: string, sourceEventId: number, action: "merge" | "reject"): {
  cardId: string; sourceEventId: number; cardType: "diff"; action: "merge" | "reject"; targetAgentId: string;
} {
  return { cardId: "worker-diff-" + agentId, sourceEventId, cardType: "diff", action, targetAgentId: agentId };
}

export function projectWorkers(events: readonly AgentEvent[]): WorkerPaneItem[] {
  const out: WorkerPaneItem[] = [];
  const byId = new Map<string, WorkerPaneItem>();
  for (const [eventIndex, e] of events.entries()) {
    const agentId = (e as { agent_id?: string }).agent_id;
    if (typeof agentId !== "string") continue;
    if (e.type === "agent_spawned") {
      const sp = e as {
        agent_id: string; mode: string; task: string; role?: string; ts?: number;
      };
      const item: WorkerPaneItem = {
        agentId,
        mode: sp.mode,
        task: sp.task,
        status: "running",
        progress: [],
        ...(sp.role !== undefined ? { role: sp.role } : {}),
        ...(sp.ts !== undefined ? { startedTs: sp.ts } : {}),
      };
      out.push(item);
      byId.set(agentId, item);
    } else if (e.type === "agent_status") {
      const item = byId.get(agentId);
      if (item === undefined) continue;
      const st = e as { status: WorkerPaneItem["status"]; reason?: string; ts?: number };
      item.status = st.status;
      if (st.reason !== undefined) item.reason = st.reason;
      if (st.ts !== undefined) item.endedTs = st.ts;
    } else if (e.type === "agent_message") {
      const item = byId.get(agentId);
      if (item === undefined) continue;
      const msg = e as { kind: string; text: string };
      if (msg.kind === "progress") item.progress.push(msg.text);
      else item.summary = msg.text;
    } else if (e.type === "agent_result") {
      const item = byId.get(agentId);
      if (item === undefined) continue;
      const r = e as {
        status: "done" | "failed"; summary: string;
        artifacts: { files_changed?: string[]; verified?: WorkerVerified; spent_usd?: number };
        usage?: { inputTokens: number; outputTokens: number };
      };
      item.status = r.status;
      item.summary = r.summary;
      if (r.artifacts.files_changed !== undefined) item.filesChanged = r.artifacts.files_changed;
      if (r.artifacts.verified !== undefined) item.verified = r.artifacts.verified;
      if (r.artifacts.spent_usd !== undefined) item.spentUsd = r.artifacts.spent_usd;
      if (r.usage !== undefined) item.usage = { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens };
      item.resultEventId = eventIndex + 1;
    }
  }
  // 终态时长（缺 started 或 ended 不算——不编）。
  for (const w of out) {
    if (w.startedTs !== undefined && w.endedTs !== undefined && w.endedTs >= w.startedTs) {
      w.durationSec = Math.round((w.endedTs - w.startedTs) / 1000);
    }
  }
  return out;
}

export { changedFileCount } from "../changed-files";

/** 检查器「改动」Tab 的数据面（P3-2）：全轮写工具改动的跨轮去重——同一文件取**最新**轮次与快照
 *  （撤销要撤到最近一次覆盖前的原件）；顺序 = 首现序（与 changedFileCount 的 Set 序同口径）。 */
export function changedFilesOf(events: readonly AgentEvent[]): Array<{
  path: string;
  change: "created" | "modified" | "unknown";
  snapshotId?: string;
  round: number;
}> {
  const byPath = new Map<string, { path: string; change: "created" | "modified" | "unknown"; snapshotId?: string; round: number }>();
  const order: string[] = [];
  for (const t of turnChanges(events)) {
    for (const f of t.files) {
      if (!byPath.has(f.path)) order.push(f.path);
      byPath.set(f.path, { path: f.path, change: f.change, round: t.round, ...(f.snapshotId !== undefined ? { snapshotId: f.snapshotId } : {}) });
    }
  }
  return order.map((p) => byPath.get(p)!);
}

/** 行级评注集合（行键 `<path>|<line>`）→ 一次性提交的消息（蓝本 §3.6：多处评论 ⌘Enter 一次性提交）。
 *  格式稳定（判卷钉）：按文件分组、行号升序；键形状不合解析的**原样保留**为兜底条目——不吞任何评论。 */
export function composeReviewMessage(comments: ReadonlyMap<string, string>): string {
  const byPath = new Map<string, { line: number; text: string; raw?: string }[]>();
  for (const [key, text] of comments) {
    const at = key.lastIndexOf("|");
    const line = at < 0 ? NaN : Number(key.slice(at + 1));
    const path = at < 0 ? key : key.slice(0, at);
    const arr = byPath.get(path) ?? [];
    if (Number.isFinite(line) && path !== "") arr.push({ line, text });
    else arr.push({ line: 0, text, raw: key });
    byPath.set(path, arr);
  }
  const parts: string[] = ["针对以下文件改动的**行级评论**（inline review），请按评论修正并重跑验证："];
  for (const [path, items] of byPath) {
    items.sort((a, b) => a.line - b.line);
    parts.push("");
    parts.push(`**${path}**`);
    for (const it of items) {
      parts.push(it.raw !== undefined ? `- ${it.text}（原键：${it.raw}）` : `- 第 ${String(it.line)} 行：${it.text}`);
    }
  }
  return parts.join("\n");
}


/** 键盘换位（2026-10-18）：窗格头焦点上按 ⌥↑ / ⌥↓ 的目标下标；到头返回 null（不环绕）。
 *  与拖拽共用 movePane——换位语义只许一处。 */
export function reorderTarget(index: number, key: "ArrowUp" | "ArrowDown", count: number): number | null {
  const to = index + (key === "ArrowUp" ? -1 : 1);
  return to < 0 || to >= count ? null : to;
}


/** 浏览器窗格的站点授权判定（蓝本 §3.5）：本地（localhost/回环/*.local）免问；
 *  已记住的域放行；其余要问（Allow once / 记住该域 / 拒绝）。解析失败按"要问"（宁可多问）。
 *  注意：这只决定"问不问"，不决定"能不能"——外站的写操作在 browse 后端侧另有安全面。 */
export function sitePermissionFor(url: string, allowed: ReadonlySet<string>): "local" | "granted" | "ask" {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "ask";
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "0.0.0.0") return "local";
  if (host.endsWith(".local")) return "local";
  return allowed.has(host) ? "granted" : "ask";
}
