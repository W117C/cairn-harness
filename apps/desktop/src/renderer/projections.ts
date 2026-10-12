// 投影纯函数（spec §3.4：UI 状态 = AgentEvent[] 的纯投影）。事件形状唯一事实源 =
// src/events/index.ts 的 AgentEvent 联合；本文件不做第二份类型，不改事件面。
import type { AgentEvent } from "../../../../src/main/ipc-protocol";
// ClarifyQuestion / PlanProposal 只在 src/events 顶层导出（ipc-protocol 未转发这两型），
// type-only 直达事实源，不在此复制第二份形状。
import type { ClarifyQuestion, PlanProposal } from "../../../../src/events";

// v2 行面：ts 为事件真值时间戳（毫秒）的透传——新事件恒有值（core 落盘统一盖戳、live=盘），
// openSession 读旧日志时 undefined ⇒ 行上留空，不造假。
// v2.16 行面补钉：user 行带 round（主会话 1-based 轮号，core planTurnRevert 同口径——worker
// 事件不成轮）；assistant 行带 eventId（事件在会话 JSONL 里的 1-based 行号，赞/踩的锚）。
export type StreamRow =
  | { kind: "user"; text: string; ts?: number; seq: number; round: number }
  | { kind: "assistant"; text: string; live?: boolean; thinking?: string; ts?: number; seq: number; eventId: number } // live=true = delta 流式中尚未被终稿取代的未结桶行；thinking = 同一 callId 下累计的思考正文
  | { kind: "tool"; tool: string; summary: string; pending?: boolean; ok?: boolean; ts?: number; seq: number }
  | { kind: "error"; text: string; ts?: number; seq: number };

type ToolRow = Extract<StreamRow, { kind: "tool" }>;

// M3-4 过滤裁定（任务书）：带 agent_id 的事件 = worker 子流（tool_call/tool_result/usage/… 的归因
// 字段，src/events/index.ts M3a §4.4.9），不进主流行、不进相位判据——主线只讲父会话的事
// （M3 不做 worker 子视图，账本留 M4+）。勘定：agent_spawned 类型上带**必填** agent_id（worker 的
// id，血缘另靠 parent_event_id），但它是父流事实（「派出了哪个 worker」）⇒ 按类型特判保留，
// 不按字段缺席判定——按字段判会把 spawn 行也滤掉。agent_status/agent_message/agent_result 属
// 必带 agent_id 的子流事件族，恒滤。
function isWorkerSubflowEvent(e: AgentEvent): boolean {
  if (e.type === "agent_spawned") return false;
  const id = (e as { agent_id?: unknown }).agent_id;
  return typeof id === "string";
}

const summarize = (args: Record<string, unknown>): string => {
  const first = args.command ?? args.path ?? args.file ?? "";
  return typeof first === "string" && first ? first : JSON.stringify(args).slice(0, 80);
};

export function projectStream(events: readonly AgentEvent[]): StreamRow[] {
  const rows: StreamRow[] = [];
  // delta 分桶（语义钉死）：callId → 累计文本 ＋ 首 delta 的 seq/ts（live 行落在流式开始的位置，
  // 时间取首 delta——行的时间戳口径与其在流里的位置一致）。桶被 assistant_message 终稿取代后即清除。
  const buckets = new Map<string, { text: string; seq: number; ts?: number }>();
  // 思考正文桶：与正文**分开累计**（思考是模型自言自语，不并进 text，转录因此保持干净）。
  const thinkingBuckets = new Map<string, string>();
  // tool_call id → 行对象：tool_result 按 callId 收口（就地改写 pending/ok，行保持 call 侧 ts）；
  // 无匹配调用的 tool_result 忽略，不造假行。
  const toolRows = new Map<string, ToolRow>();
  // 轮号（v2.16）：主会话 user_message 的 1-based 计数——与 core planTurnRevert 的轮口径同一份
  // （worker 子流事件不成轮，见 isWorkerSubflowEvent 过滤；worker 本也不产生 user_message）。
  let rounds = 0;
  for (let seq = 0; seq < events.length; seq++) {
    const e = events[seq]!;
    // M3-4 裁定：worker 子流事件不进主流行（过滤判据见 isWorkerSubflowEvent）；seq 仍按事件
    // 全序编号，行序与流序一致，不因过滤错位。
    if (isWorkerSubflowEvent(e)) continue;
    switch (e.type) {
      case "user_message": rounds += 1; rows.push({ kind: "user", text: e.content, ts: e.ts, seq, round: rounds }); break;
      case "assistant_message":
        // 终稿到达：AssistantMessageEvent 无 callId，无法按桶匹配 ⇒ 全部未结桶被终稿行取代
        //（live=false），此后不再输出这些桶的 live 行。
        // 终稿到达：思考桶里的正文**挂到终稿行上再清**——这样输出结束后用户仍能看到那一轮想了什么
        //（清空后消失的话，"思考过程"只在流式那几秒可见，等于没展示）。
        const carriedThinking = [...thinkingBuckets.values()].join("") || undefined;
        buckets.clear();
        thinkingBuckets.clear();
        rows.push({
          kind: "assistant", text: e.content, live: false, ts: e.ts, seq, eventId: seq + 1,
          ...(carriedThinking !== undefined ? { thinking: carriedThinking } : {}),
        });
        break;
      case "assistant_delta": {
        const bucket = buckets.get(e.callId);
        if (bucket === undefined) buckets.set(e.callId, { text: e.text, seq, ts: e.ts });
        else bucket.text += e.text;
        break;
      }
      case "thinking_delta": {
        // 不进正文桶：走独立累计，渲染时挂在回答行前面单独一段。
        thinkingBuckets.set(e.callId, (thinkingBuckets.get(e.callId) ?? "") + e.text);
        // 思考阶段也要有 live 行承载 ThinkingLive（否则「先思考」无处落脚，二者只剩同时出现）。
        // 建 text="" 的桶，后续 assistant_delta 来到同一 callId 即累积正文——该行自动成为输出行。
        if (!buckets.has(e.callId)) buckets.set(e.callId, { text: "", seq, ts: e.ts });
        break;
      }
      // 勘误落地：ToolCallEvent 的工具名字段是 name（不是计划作者预期的 tool）；行面仍叫 tool。
      case "tool_call": {
        const row: ToolRow = { kind: "tool", tool: e.name, summary: summarize(e.args), pending: true, ts: e.ts, seq };
        toolRows.set(e.id, row);
        rows.push(row);
        break;
      }
      case "tool_result": {
        const row = toolRows.get(e.callId);
        if (row) { row.pending = false; row.ok = e.ok; }
        break;
      }
      // M3-4 裁定：agent_spawned 是父流事实，保留为 tool 类行——summary=task 截断（与 summarize
      // 的 80 字符口径一致），tool 名取 core 的 spawn 工具名。行不带 pending：spawn 本身无收口对
      // （worker 的终态走 agent_status/agent_result 子流，本就不进主流）。
      case "agent_spawned":
        rows.push({ kind: "tool", tool: "spawn_agent", summary: e.task.slice(0, 80), ts: e.ts, seq });
        break;
      // RunErrorEvent 勘定（src/events/index.ts）：失败原因原文在 message（渲染侧负责转义）。
      case "error": rows.push({ kind: "error", text: e.message, ts: e.ts, seq }); break;
      default: break; // 其余事件类型不成行：clarify/plan 走卡片选择器（pendingClarifyOf/pendingPlanOf）
    }
  }
  // 未结桶 ⇒ live=true 的 assistant 行（text=该桶累计），按首 delta 的 seq 归位后与既有行并序。
  for (const [callId, bucket] of buckets) {
    rows.push({
      kind: "assistant", text: bucket.text, live: true, ts: bucket.ts, seq: bucket.seq, eventId: bucket.seq + 1,
      ...(thinkingBuckets.get(callId) ? { thinking: thinkingBuckets.get(callId) } : {}),
    });
  }
  return rows.sort((a, b) => a.seq - b.seq);
}

export type RunPhase = "idle" | "thinking" | "tool" | "ask" | "clarify" | "plan";

/**
 * 尾扫判据（v2 语义钉死）：pending 三参任一 true ⇒ 对应门相位，ask 优先级最高；
 * 否则从尾向头扫——未决 tool_call（其后无同 id 的 tool_result）⇒ "tool"；
 * 晚于最后 tool_result 的 assistant_delta ⇒ "thinking"（扫描途中已见 result 的 delta 一律跳过，
 * 那些是「早于最后 tool_result」的 delta，判据不成立）；error 在尾部 ⇒ "idle"（error 行自呈现，不再判忙）。
 * pendingClarify/pendingPlan 带缺省 false：M1 的两参调用式（App.tsx 与 M1 存量用例）保持可编译，
 * 任务书 Interfaces 的四参调用式逐字可用。
 */
export function deriveRunPhase(
  events: readonly AgentEvent[],
  pendingAsk: boolean,
  pendingClarify: boolean = false,
  pendingPlan: boolean = false,
): RunPhase {
  if (pendingAsk) return "ask";
  if (pendingClarify) return "clarify";
  if (pendingPlan) return "plan";
  const seenResults = new Set<string>(); // 尾扫途中已见的 result callId（都晚于当前扫描位）
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    // M3-4 裁定：worker 子流不进相位判据——未决 worker tool_call 不亮「tool」，worker
    // tool_result 也不占用 seenResults（否则它会把「delta 晚于最后 result = thinking」的判据吃掉）。
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "tool_result") { seenResults.add(e.callId); continue; }
    if (e.type === "tool_call" && !seenResults.has(e.id)) return "tool";
    if (e.type === "assistant_delta" && seenResults.size === 0) return "thinking";
    if (e.type === "error") return "idle";
  }
  return "idle";
}

/** 最后一个 clarify_requested，且其后无同 callId 的 tool_result（澄清门的答复按原工具 id 挂回）。
 *  只看最后一个请求：其后已收口 ⇒ null（更早的未决请求不追溯，与门的串行语义一致）。 */
export function pendingClarifyOf(events: readonly AgentEvent[]): { callId: string; questions: ClarifyQuestion[] } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "clarify_requested") continue;
    const closed = events.slice(i + 1).some((r) => r.type === "tool_result" && r.callId === e.callId);
    return closed ? null : { callId: e.callId, questions: e.questions };
  }
  return null;
}

/** 最后一个 plan_proposed，且其后无同 callId 的 plan_approved（批准与拒绝都算决议收口）。 */
export function pendingPlanOf(events: readonly AgentEvent[]): { callId: string; plan: PlanProposal } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "plan_proposed") continue;
    const closed = events.slice(i + 1).some((r) => r.type === "plan_approved" && r.callId === e.callId);
    return closed ? null : { callId: e.callId, plan: e.plan };
  }
  return null;
}

/** 累加全部 usage 事件；缺字段当 0（UsageEvent 字段必在，防御旧日志），并给消费方事件计数。
 *  v3（状态条对齐原型 renderStatus）：cacheReadTokens = 各事件缓存读之和（缺席不计，不是 0——
 *  「没量到」不冒充「量到了 0」）；lastInputTokens = 最后一条 usage 的输入（上下文水位≈末轮输入，
 *  累加值会虚高，不能拿来算上下文百分比）。 */
export function usageAggregate(events: readonly AgentEvent[]): {
  inputTokens: number; outputTokens: number; usageCount: number; cacheReadTokens: number; lastInputTokens: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let usageCount = 0;
  let cacheReadTokens = 0;
  let lastInputTokens = 0;
  for (const e of events) {
    if (e.type !== "usage") continue;
    usageCount += 1;
    inputTokens += typeof e.inputTokens === "number" ? e.inputTokens : 0;
    outputTokens += typeof e.outputTokens === "number" ? e.outputTokens : 0;
    if (typeof (e as { cacheReadInputTokens?: unknown }).cacheReadInputTokens === "number") {
      cacheReadTokens += (e as { cacheReadInputTokens: number }).cacheReadInputTokens;
    }
    if (typeof e.inputTokens === "number") lastInputTokens = e.inputTokens;
  }
  return { inputTokens, outputTokens, usageCount, cacheReadTokens, lastInputTokens };
}

/** 步数（状态条「N 轮 · M 步」的 M）：主会话 tool_call 计数（worker 子流不计，同 projectStream 口径）。 */
export function countToolSteps(events: readonly AgentEvent[]): number {
  let steps = 0;
  for (const e of events) {
    if (e.type === "tool_call" && !isWorkerSubflowEvent(e)) steps += 1;
  }
  return steps;
}

/** 相对时间（语义钉死分界）：<60s "刚刚"；<60m "N 分钟前"；<24h "N 小时前"；<7d "N 天前"；
 *  否则本地日期 YYYY-MM-DD。未来时间戳（diff 为负）落入第一档显 "刚刚"，不显负数。 */
export function relativeTime(nowMs: number, tsMs: number): string {  const diff = nowMs - tsMs;
  if (diff < 60_000) return "刚刚";
  if (diff < 60 * 60_000) return `${String(Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${String(Math.floor(diff / 3_600_000))} 小时前`;
  if (diff < 7 * 24 * 60 * 60_000) return `${String(Math.floor(diff / 86_400_000))} 天前`;
  const d = new Date(tsMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}-${mm}-${dd}`;
}

/** 文件级回滚（v2.16）的结果提示文案（纯函数，可判卷）：还原/删除两段计数恒在；
 *  manual（轮后又被改过、取不到原件——core 拒绝静默抹掉）与 failed（越界/快照缺失）有货才显，
 *  点名路径——「看不见的降级等于没降级」。 */
export function formatRevertNotice(
  round: number,
  r: { restored: string[]; deleted: string[]; manual: { path: string; why: string }[]; failed: { path: string; error: string }[] },
): string {
  const parts = [`第 ${String(round)} 轮文件回滚：还原 ${String(r.restored.length)} 个、删除 ${String(r.deleted.length)} 个`];
  if (r.manual.length > 0) parts.push(`需手动处理 ${String(r.manual.length)} 个（${r.manual.map((m) => m.path).join("、")}）`);
  if (r.failed.length > 0) parts.push(`失败 ${String(r.failed.length)} 个（${r.failed.map((f) => f.path).join("、")}）`);
  return parts.join("；");
}

/** v2.12 轮次时间线（rail）的投影：每条 = 一轮（user 发问 + 模型回复），供 rail 线段与悬停
 *  信息面板取料。回复摘要 = 该轮第一条 assistant 行截断；无模型行回退 null（面板标注「结果：」缺）。 */
export function roundTimeline(
  rows: readonly StreamRow[],
): Array<{ round: number; userText: string; replySummary: string | null; ts?: number }> {
  const out: Array<{ round: number; userText: string; replySummary: string | null; ts?: number }> = [];
  let current: (typeof out)[number] | null = null;
  for (const r of rows) {
    if (r.kind === "user") {
      if (current !== null) out.push(current);
      current = { round: r.round, userText: r.text, replySummary: null, ...(r.ts !== undefined ? { ts: r.ts } : {}) };
    } else if (r.kind === "assistant" && current !== null && current.replySummary === null) {
      current.replySummary = r.text.slice(0, 120);
    }
  }
  if (current !== null) out.push(current);
  return out;
}

/** C-32 ChangeSummaryCard 的投影（v2 输出优先）：按轮聚合写工具改动——user 行开新轮，
 *  写类 tool_call（write_file/edit_file/apply_patch）与其 tool_result 配对后计入该轮；
 *  change 字段缺席标 unknown（不猜 created/modified）；worker 子流事件已在 projectStream
 *  的过滤之外（此处直接吃原始事件，沿用同一过滤判据）。 */
export function turnChanges(events: readonly AgentEvent[]): Array<{
  round: number;
  files: Array<{ path: string; change: "created" | "modified" | "unknown"; snapshotId?: string }>;
}> {
  const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);
  const isWorker = (e: AgentEvent): boolean =>
    e.type !== "agent_spawned" && typeof (e as { agent_id?: unknown }).agent_id === "string";
  const out: Array<{ round: number; files: Array<{ path: string; change: "created" | "modified" | "unknown"; snapshotId?: string }> }> = [];
  let round = 0;
  let current: (typeof out)[number] | null = null;
  // tool_call id → { path }（写工具才登记）；tool_result 按 callId 收口并计入当前轮。
  const pendingWrites = new Map<string, { path: string }>();
  for (const e of events) {
    if (isWorker(e)) continue;
    if (e.type === "user_message") {
      if (current !== null && current.files.length > 0) out.push(current);
      round += 1;
      current = { round, files: [] };
      continue;
    }
    if (e.type === "tool_call" && WRITE_TOOLS.has(e.name)) {
      const p = e.args.path;
      if (typeof p === "string" && p !== "") pendingWrites.set(e.id, { path: p });
      continue;
    }
    if (e.type === "tool_result" && current !== null) {
      const call = pendingWrites.get(e.callId);
      if (call === undefined) continue;
      pendingWrites.delete(e.callId);
      // 同一文件轮内多笔只记一次（首次的 change 口径）。
      if (current.files.some((f) => f.path === call.path)) continue;
      current.files.push({
        path: call.path,
        change: e.change === "created" ? "created" : e.change === "modified" ? "modified" : "unknown",
        ...(e.snapshotId !== undefined ? { snapshotId: e.snapshotId } : {}),
      });
    }
  }
  if (current !== null && current.files.length > 0) out.push(current);
  return out;
}
