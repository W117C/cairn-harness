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
// v7 行面补钉：assistant 行也带 round（它所属的用户轮——「从这条回复分支」= fork 保留到该轮）。
export type StreamRow =
  | { kind: "user"; text: string; ts?: number; seq: number; round: number; attachments?: readonly { path: string; kind: "file" | "directory" }[] }
  | { kind: "assistant"; text: string; live?: boolean; thinking?: string; ts?: number; seq: number; eventId: number; round: number } // live=true = delta 流式中尚未被终稿取代的未结桶行；thinking = 同一 callId 下累计的思考正文
  | { kind: "tool"; tool: string; summary: string; path?: string; args?: string; output?: string; outputTruncated?: boolean; pending?: boolean; interrupted?: boolean; ok?: boolean; ts?: number; seq: number
      /** tool_result 收口的到达时间（P3-1 折叠行耗时 = then − ts；拿不到不显）。 */
      then?: number
      /** 产物引用（本次调用交付给用户的东西）。从前聊天里只有文字回执 ⇒ 用户看不到 agent
       *  刚渲染的图，也拿不到"刚写的那份 HTML"的直接入口，只能自己去仓库里翻。 */
      artifact?: { kind: "image" | "html" | "svg" | "text"; path: string; note?: string } }
  | { kind: "error"; text: string; ts?: number; seq: number };

type ToolRow = Extract<StreamRow, { kind: "tool" }>;

// M3-4 过滤裁定（任务书）：带 agent_id 的事件 = worker 子流（tool_call/tool_result/usage/… 的归因
// 字段，src/events/index.ts M3a §4.4.9），不进主流行、不进相位判据——主线只讲父会话的事
// （M3 不做 worker 子视图，账本留 M4+）。勘定：agent_spawned 类型上带**必填** agent_id（worker 的
// id，血缘另靠 parent_event_id），但它是父流事实（「派出了哪个 worker」）⇒ 按类型特判保留，
// 不按字段缺席判定——按字段判会把 spawn 行也滤掉。agent_status/agent_message/agent_result 属
// 必带 agent_id 的子流事件族，恒滤。
// 导出：对话转录也要走这同一条过滤（worker 子流的 delta 不是主会话的对话正文）。
// 判据自己抄一遍就会漂——所以这里导出，让 transcript.ts 用同一份。
export function isWorkerSubflowEvent(e: AgentEvent): boolean {
  if (e.type === "agent_spawned") return false;
  const id = (e as { agent_id?: unknown }).agent_id;
  return typeof id === "string";
}

/** 独立窗格窗口（PopoutApp）收不收这条事件——**归属**判据，纯函数。
 *
 *  旧实现在组件里内联写着 `props.sessionId === null || sid === undefined || sid === props.sessionId`：
 *  第一个析取项为真时，后面两项全是废话 ⇒ 一个**没有会话归属**的弹出窗会把**所有会话**的事件
 *  都吸进来。而这种窗格是真实存在的路径：⌘N 回首页时 paneTabs 不清，⧉ 传的是 undefined。
 *  用户于是在一个只有「变更」两个字的窗格里，读到**另一个会话**的轮次、文件与验证状态，
 *  而空态还写着"本会话还没有文件改动"——两句话互相打架。
 *
 *  三条判据各自的理由：
 *  · `sessionId === null` ⇒ **没有归属就不显示**（不是"全都显示"）。显示别人的会话比不显示更坏。
 *  · `sid === undefined` ⇒ 事件没盖章归属。推送是广播来的（所有窗口都收得到），没盖章的
 *    那条**不属于任何会话**，让它进来就等于让弹出窗回到"什么都收"的老毛病。
 *  · `session_titled` 是 push-only 的命名推送（第十八遍的既定口径），与窗格内容无关。
 */
export function popoutEventBelongsTo(e: AgentEvent, sessionId: string | null): boolean {
  if (sessionId === null) return false;
  if ((e as { type?: string }).type === "session_titled") return false;
  const sid = (e as { session_id?: string }).session_id;
  if (sid === undefined) return false;
  return sid === sessionId;
}

/** 运行秒表读数：起点按**会话**存，读的时候只读**当前会话**那一格。
 *
 *  旧实现是**一个** ref（谁起跑就盖谁）+ 读的时候无条件取它 ⇒ A 起跑、切 B、B 起跑、
 *  切回 A（A 还在跑）时，秒表算的是 `now − B 的起点`：A 真实跑了 3600s 会显示成 0s。
 *  秒表是"这一轮跑了多久"的用户可见读数，读错比不读更坏（用户以为任务刚开始）。
 *
 *  纯函数形态（起点表 + 会话 id + 当前时刻 → 秒数），让判卷能真跑这一格，
 *  不必退化成源码断言。缺起点（这一格还没盖）按"现在起算"⇒ 0s，不编一个假起点。 */
export function elapsedSecondsFor(
  startBySession: ReadonlyMap<string, number>,
  sessionId: string | null,
  now: number,
): number {
  if (sessionId === null) return 0;
  const t0 = startBySession.get(sessionId);
  if (t0 === undefined) return 0;
  return Math.max(0, Math.floor((now - t0) / 1000));
}

/** 主会话终态判据（运行旗/侧栏黄点唯一处）：worker 的 agent_status 也是 agent_status 且
 *  同样被盖上父会话 session_id（agent-runner 的 outbox 盖章），不能据此摘主会话的运行旗。 */
export function isMainSessionTerminalEvent(e: AgentEvent): boolean {
  if (isWorkerSubflowEvent(e)) return false;
  if (e.type !== "agent_status") return false;
  const status = (e as { status?: unknown }).status;
  return status === "done" || status === "failed" || status === "cancelled";
}

/** 打开会话时的快照合并：openSession 读盘期间 onEvent 仍会追加 live 事件；
 *  直接 setEvents(快照) 会丢掉这段增量（长会话可达数百毫秒）。pending 从快照尾巴之后开始，
 *  用「后缀/前缀重叠」去重——重叠部分已在快照里，其余按序接上。
 *  事件没有全局 seq，只能按内容比；同一事件在两侧的序列化逐字节一致（同一 JSONL 行）。 */
export function mergeSessionSnapshot(
  snapshot: readonly AgentEvent[],
  pending: readonly AgentEvent[],
): AgentEvent[] {
  if (pending.length === 0) return [...snapshot];
  const pendingText = pending.map((e) => JSON.stringify(e));
  const max = Math.min(snapshot.length, pending.length);
  for (let k = max; k > 0; k -= 1) {
    let same = true;
    for (let i = 0; i < k; i += 1) {
      if (JSON.stringify(snapshot[snapshot.length - k + i]) !== pendingText[i]) {
        same = false;
        break;
      }
    }
    if (same) return [...snapshot, ...pending.slice(k)];
  }
  return [...snapshot, ...pending];
}

const summarize = (args: Record<string, unknown>): string => {
  // url / query 进取值链（阶段 2 · brief §二.4 例：「抓取 api-docs.deepseek.com/news」——
  // web_fetch/web_search 的一句话摘要就是目标本身）。
  const first = args.command ?? args.path ?? args.file ?? args.url ?? args.query ?? "";
  return typeof first === "string" && first ? first : JSON.stringify(args).slice(0, 80);
};

/** 工具行展开区数据源（阶段 2 · brief §二.4）：原始参数的美化 JSON（2 格缩进）。
 *  超 1500 字截断加省略标记——折叠区不摆巨物；原始事件面不动，这里只是展示层的字符串。 */
const rawArgs = (args: Record<string, unknown>): string => {
  const s = JSON.stringify(args, null, 2);
  return s.length > 1500 ? `${s.slice(0, 1500)}…` : s;
};

export function projectStream(events: readonly AgentEvent[], running: boolean = true): StreamRow[] {
  const rows: StreamRow[] = [];
  // delta 分桶（语义钉死）：callId → 累计文本 ＋ 首 delta 的 seq/ts（live 行落在流式开始的位置，
  // 时间取首 delta——行的时间戳口径与其在流里的位置一致）。桶被 assistant_message 终稿取代后即清除。
  const buckets = new Map<string, { text: string; seq: number; ts?: number }>();
  // 思考正文桶：与正文**分开累计**（思考是模型自言自语，不并进 text，转录因此保持干净）。
  const thinkingBuckets = new Map<string, string>();
  // tool_call id → 行对象：tool_result 按 callId 收口（就地改写 pending/ok，行保持 call 侧 ts）；
  // 无匹配调用的 tool_result 忽略，不造假行。
  const toolRows = new Map<string, ToolRow>();
  const interruptTools = (): void => {
    for (const row of toolRows.values()) {
      if (row.pending !== true) continue;
      row.pending = false;
      row.interrupted = true;
    }
  };
  // 轮号（v2.16）：主会话 user_message 的 1-based 计数——与 core planTurnRevert 的轮口径同一份
  // （worker 子流事件不成轮，见 isWorkerSubflowEvent 过滤；worker 本也不产生 user_message）。
  let rounds = 0;
  // 落定未结桶（v7.1 修）：真实 provider 的**一轮只发 assistant_delta**（aggregate 的 assistant_message
  // 是 mock/demo 通道才有的东西，见 src/cli.ts 的刻意注释）——所以「桶什么时候算说完」不能只靠
  // assistant_message。轮界（下一条 user_message）与停转（running=false）都是落定点：以终稿形态
  // （live=false）吐行，操作条与光标据此归位。settled=true 时空文本桶（只想过没说的半轮）不产行。
  const flushBuckets = (settled: boolean): void => {
    for (const [callId, bucket] of buckets) {
      if (settled && bucket.text === "") continue;
      rows.push({
        kind: "assistant", text: bucket.text, live: settled ? false : true, ts: bucket.ts, seq: bucket.seq, eventId: bucket.seq + 1, round: rounds,
        ...(thinkingBuckets.get(callId) ? { thinking: thinkingBuckets.get(callId) } : {}),
      });
    }
    buckets.clear();
    thinkingBuckets.clear();
  };
  for (let seq = 0; seq < events.length; seq++) {
    const e = events[seq]!;
    // M3-4 裁定：worker 子流事件不进主流行（过滤判据见 isWorkerSubflowEvent）；seq 仍按事件
    // 全序编号，行序与流序一致，不因过滤错位。
    if (isWorkerSubflowEvent(e)) continue;
    switch (e.type) {
      case "user_message":
        // 轮界：上一轮还没被终稿收走的桶在此落定（新消息开头 = 旧轮已说完）。
        flushBuckets(true);
        rounds += 1;
        rows.push({
          kind: "user", text: userVisibleText(e), ts: e.ts, seq, round: rounds,
          ...(e.attachments !== undefined && e.attachments.length > 0 ? { attachments: e.attachments } : {}),
        });
        break;
      case "assistant_message":
        // 终稿到达：AssistantMessageEvent 无 callId，无法按桶匹配 ⇒ 全部未结桶被终稿行取代
        //（live=false），此后不再输出这些桶的 live 行。
        // 终稿到达：思考桶里的正文**挂到终稿行上再清**——这样输出结束后用户仍能看到那一轮想了什么
        //（清空后消失的话，"思考过程"只在流式那几秒可见，等于没展示）。
        const carriedThinking = [...thinkingBuckets.values()].join("") || undefined;
        buckets.clear();
        thinkingBuckets.clear();
        rows.push({
          kind: "assistant", text: e.content, live: false, ts: e.ts, seq, eventId: seq + 1, round: rounds,
          ...(carriedThinking !== undefined ? { thinking: carriedThinking } : {}),
        });
        break;
      case "assistant_delta": {
        const bucket = buckets.get(e.callId);
        if (bucket === undefined) buckets.set(e.callId, { text: e.text, seq, ts: e.ts });
        else bucket.text += e.text;
        break;
      }
      // 第十九遍（业主 21.51.47「输出完之后橙色竖线还闪一下才停」）：usage = 本次模型调用说完了的
      // 精确落定点（openai.ts 在流末 yield usage；案卷 21:51:38 实证：末 delta 与 usage 同秒，
      // 之后 10s 尾部记忆沉淀才收束——旧判据 running=false 让光标陪跑了整个尾巴）。
      // 工具轮里 usage 亦在 tool_result 之后、下一 call 之前到达 ⇒ 桶不跨调用，flush 语义干净；
      // 空文本桶（只想过没说）在此落定即按既有口径弃行。
      case "usage": {
        flushBuckets(true);
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
        const row: ToolRow = { kind: "tool", tool: e.name, summary: summarize(e.args), args: rawArgs(e.args), pending: true, ts: e.ts, seq };
        // 行为数据不从展示用截断 JSON 反解；长编辑参数仍保留差异入口。
        if (typeof e.args.path === "string" && e.args.path !== "") row.path = e.args.path;
        toolRows.set(e.id, row);
        rows.push(row);
        break;
      }
      case "tool_result": {
        const row = toolRows.get(e.callId);
        if (row) {
          row.pending = false;
          delete row.interrupted;
          row.ok = e.ok;
          if (typeof e.output === "string") {
            row.output = e.output.slice(0, 10000);
            if (e.output.length > 10000) row.outputTruncated = true;
          }
          if (e.ts !== undefined) row.then = e.ts; // P3-1：耗时的落地端（ts→then 一段）
          // 只认**成功**的产物：失败的那一笔没有可看的东西（写盘被拒 / 渲染超时）。
          if (e.ok && e.artifact !== undefined) row.artifact = e.artifact;
        }
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
      case "agent_status":
        if (isMainSessionTerminalEvent(e)) interruptTools();
        break;
      default: break; // 其余事件类型不成行：clarify/plan 走卡片选择器（pendingClarifyOf/pendingPlanOf）
    }
  }
  // 尾部未结桶（按首 delta 的 seq 归位后与既有行并序——末尾 sort 统一收口）：
  // 运行中 ⇒ live=true 行（追字光标只该亮在正在流的那一段）；会话已停 ⇒ 同样是终稿（live=false），
  // 操作条与「思考完成」据此显形——真实 provider 不补发 assistant_message，停转就是落定信号。
  flushBuckets(!running);
  if (!running) interruptTools();
  return rows.sort((a, b) => a.seq - b.seq);
}

/** 事件 id（1-based 行号，assistant 行 eventId 同口径）→ 所属轮号（1-based）。P3-1 回放/分叉的
 *  轮号自事件日志投影（hover 操作对「事件日志的 fork/replay」的接口）。轮界口径与 projectStream
 *  的 rounds 计数同一份：主会话 user_message 计数（worker 子流先滤）；事件在首个用户消息之前
 *  或 id 越界（<1 / > events.length）→ null（不猜）。 */
export function roundOfEvent(events: readonly AgentEvent[], eventId: number): number | null {
  if (!Number.isInteger(eventId) || eventId < 1 || eventId > events.length) return null;
  let rounds = 0;
  for (let i = 0; i < eventId; i++) {
    const e = events[i]!;
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "user_message") rounds += 1;
  }
  return rounds === 0 ? null : rounds;
}

/** 第 N 轮的用户输入原文（回放 = fork 到该轮后把它注入新会话输入框）。拿不到 → null，不编。 */
/** 用户面原文（2026-10-18）：技能调用轮的事件 content 是**展开后的技能提示词**（模型面），
 *  直接显示会把整份 SKILL.md 当成用户说的话。skill 元信息在 ⇒ 还原成用户敲的 `<invoke> <args>`；
 *  缺席（普通消息）⇒ 原样。事件本身不改：重放/续跑要的是展开后的上下文。 */
export function userVisibleText(e: { content: string; skill?: { invoke: string; args: string } }): string {
  if (e.skill === undefined) return e.content;
  const args = e.skill.args.trim();
  return args === "" ? e.skill.invoke : `${e.skill.invoke} ${args}`;
}

export function userTextOfRound(events: readonly AgentEvent[], round: number): string | null {
  if (!Number.isInteger(round) || round < 1) return null;
  let rounds = 0;
  for (const e of events) {
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "user_message") {
      rounds += 1;
      if (rounds === round) return userVisibleText(e);
    }
  }
  return null;
}

/** 步骤时间线（P3-2 检查器「时间线」Tab 的数据面）——事件日志 → 步骤序列。
 *  「只取在场字段，不编时间」：at 直接取事件 ts（缺席即不给），label 是在场文本的截断。
 *  落步口径：user_message → user 步；tool_call → tool 步（name + 摘要）；
 *  assistant 内容在真实 provider 是 delta-only（aggregate 终稿是 mock/demo 通道的产品）⇒
 *  **每个 callId 的首个 delta** 落一个 assistant 步（后续 delta 并入——与「回放到此步」的
 *  段落开头语义一致）；assistant_message 终稿是独立一笔事件，照落（demo 通道会同时有两者，
 *  这里如实两步——都是真实事件，不合并）。usage → 用量步（「模型调用说完了」的精确落定点）。
 *  worker 子流不进（与主流行同一过滤）；error 在对话行自呈现，时间线不为它立步。 */
export interface TimelineItem {
  /** 事件全序的 1-based 行号（assistant 行 eventId / DOM data-event-id 同口径）。 */
  eventId: number;
  kind: "user" | "tool" | "assistant" | "usage";
  label: string;
  /** 事件真值时间戳（毫秒）；缺席 = 旧日志没戳，不编。 */
  at?: number;
}

const TIMELINE_LABEL_MAX = 60;
const timelineLabel = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TIMELINE_LABEL_MAX ? flat : flat.slice(0, TIMELINE_LABEL_MAX) + "…";
};
const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

export function timelineItems(events: readonly AgentEvent[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  const seenDeltaCalls = new Set<string>(); // 已落步的 callId（其后续 delta 并入首步）
  for (let seq = 0; seq < events.length; seq++) {
    const e = events[seq]!;
    if (isWorkerSubflowEvent(e)) continue;
    const eventId = seq + 1;
    switch (e.type) {
      case "user_message":
        out.push({ eventId, kind: "user", label: timelineLabel(e.content), ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      case "assistant_delta":
        if (seenDeltaCalls.has(e.callId)) break;
        seenDeltaCalls.add(e.callId);
        out.push({ eventId, kind: "assistant", label: timelineLabel(e.text), ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      case "assistant_message":
        out.push({ eventId, kind: "assistant", label: timelineLabel(e.content), ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      case "tool_call":
        out.push({ eventId, kind: "tool", label: timelineLabel(`${e.name} ${summarize(e.args)}`), ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      case "usage":
        out.push({ eventId, kind: "usage", label: `输入 ${fmtTokens(e.inputTokens)} · 输出 ${fmtTokens(e.outputTokens)}`, ...(e.ts !== undefined ? { at: e.ts } : {}) });
        break;
      default:
        break; // clarify/plan/error 等：对话面有专卡/专行，时间线不为它们立步
    }
  }
  return out;
}

export type RunPhase = "idle" | "thinking" | "tool" | "ask" | "clarify" | "plan";

/** 尾扫判据（v2 语义钉死）：pending 三参任一 true ⇒ 对应门相位，ask 优先级最高；
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

/** 本轮（最后一条主会话 user_message 之后）是否已有模型正文。
 *  用途：状态条不能把「正文已经开始/已经输出完、run 还在收尾」继续叫「思考中」。
 *  worker 子流正文不算（父会话唯一接收物是 agent_result）。 */
export function hasAssistantTextThisRun(events: readonly AgentEvent[]): boolean {
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "user_message") { start = i; break; }
  }
  for (let i = start; i < events.length; i++) {
    const e = events[i]!;
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "assistant_message" && e.content.trim() !== "") return true;
    if (e.type === "assistant_delta" && e.text.trim() !== "") return true;
  }
  return false;
}

/** 状态条那一格的文案（纯函数，好判卷；2026-10-20 从 App.tsx 搬出来）。
 *
 *  口径（逐条，顺序即优先级）：
 *  ① 已停止 ⇒ "已停止"；
 *  ② 三道门在场 ⇒ "等待审批" / "等待澄清" / "等待方案"；
 *  ③ **工具在跑 ⇒ "执行工具"**（这一条排在"收尾中"**之前**——2026-10-20 独立评审追出的 MEDIUM-HIGH：
 *     旧实现先判 `finishing`，而 `finishing` 的第二个条件 `answerQuiet`（正文停了 >1.5s）
 *     **恰好就是"工具在跑"的形状**（模型吐完字就调工具，然后等着它跑完）
 *     ⇒ 任何超过 1.5s 的构建/测试都被报成"收尾中"，而 agent 还在干活。
 *     那条注释自己写着「读错比不读更坏」——报错的相位比不报更坏）；
 *  ④ 正文停了而 run 还在 ⇒ "收尾中"（Stop hook / 安全报告 / 记忆沉淀那几样）；
 *  ⑤ 有正文 ⇒ "生成中"；还没有 ⇒ "思考中"；
 *  ⑥ run 还在但没有正文 ⇒ "思考中"；都不在 ⇒ "就绪"。
 */
export function runPhaseLabel(input: {
  phase: RunPhase;
  stopped: boolean;
  running: boolean;
  /** 本轮已经有模型正文（`hasAssistantTextThisRun`）。 */
  hasAnswerText: boolean;
  /** 正文已停 >1.5s（App 的 `answerQuiet`）。 */
  answerQuiet: boolean;
}): string {
  if (input.stopped) return "已停止";
  if (input.phase === "ask") return "等待审批";
  if (input.phase === "clarify") return "等待澄清";
  if (input.phase === "plan") return "等待方案";
  // 工具在跑 ⇒ 不是收尾（见上：answerQuiet 与"工具在跑"同形）
  if (input.phase === "tool") return "执行工具";
  const finishing = input.running && input.hasAnswerText && (input.phase === "idle" || input.answerQuiet);
  if (finishing) return "收尾中";
  if (input.phase === "thinking") return input.hasAnswerText ? "生成中" : "思考中";
  if (input.running) return input.hasAnswerText ? "收尾中" : "思考中";
  return "就绪";
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

/** 用量统计（2026-10-20 批 130 · 头像菜单的「用量统计」面板读它）。
 *  口径与 `usageAggregate` 一致（同一份 usage 事件、同一套缺字段当 0 的防御），
 *  外加步数与轮数两个「非 token」维度。纯函数 ⇒ 可判卷。
 *  **只算当前会话**：跨会话汇总需要把所有会话的事件都读一遍（渲染层拿不到，
 *  主进程也没有这个账本）——面板如实写「当前会话」，不拿单会话的数字冒充全局。 */
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usageCount: number;
  toolSteps: number;
  rounds: number;
}

export function usageSummary(events: readonly AgentEvent[]): UsageSummary {
  const agg = usageAggregate(events);
  let rounds = 0;
  for (const e of events) {
    if (e.type === "user_message") rounds += 1;
  }
  return {
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    cacheReadTokens: agg.cacheReadTokens,
    usageCount: agg.usageCount,
    toolSteps: countToolSteps(events),
    rounds,
  };
}

/** 步数（状态条「N 轮 · M 步」的 M）：主会话 tool_call 计数（worker 子流不计，同 projectStream 口径）。 */
export function countToolSteps(events: readonly AgentEvent[]): number {  let steps = 0;
  for (const e of events) {
    if (e.type === "tool_call" && !isWorkerSubflowEvent(e)) steps += 1;
  }
  return steps;
}

/** 本轮步数（2026-10-18）：最后一个 user_message 之后的 tool_call 数——状态条要的是“这一轮做了几步”。
 *  不能直接拿 countToolSteps（那是整条会话的累计）。工头子流程不计（与累计口径同一谓词）。 */
export function countRunSteps(events: readonly AgentEvent[]): number {
  // 找不到 user_message 时返回 0，而不是把整条会话的历史步数冒充成本轮——状态条宁可空着。
  let start = events.length;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.type === "user_message") { start = i + 1; break; }
  }
  let steps = 0;
  for (let i = start; i < events.length; i += 1) {
    const e = events[i]!;
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

export type TurnVerificationStatus = "not-required" | "absent" | "stale" | "verified" | "failed";

export interface TurnVerificationEvidence {
  command: string;
  ok: boolean;
  output: string;
  cause?: string;
  exitCode?: number | null;
}

export interface TurnDelivery {
  round: number;
  files: Array<{ path: string; change: "created" | "modified" | "unknown"; snapshotId?: string }>;
  verification: {
    status: TurnVerificationStatus;
    attempts: number;
    latest: {
      ok: boolean;
      auto: boolean;
      attempt: number;
      maxAttempts: number;
      results: TurnVerificationEvidence[];
    } | null;
  };
  unverifiedFiles: string[];
  nextAction: string;
}

interface InternalVerification {
  index: number;
  ok: boolean;
  auto: boolean;
  attempt: number;
  maxAttempts: number;
  results: TurnVerificationEvidence[];
}

interface InternalTurn {
  round: number;
  files: TurnDelivery["files"];
  lastWriteIndex: number;
  verifications: InternalVerification[];
}

/** 被显式还原过、且此后**没有再被写**的文件集合（退出改动面的那些）。
 *
 *  为什么要有这一格：还原（检查器「撤销此文件改动」）此前只改盘上的文件、**不留任何事件**，
 *  而改动面全部从事件流投影 ⇒ 还原之后那一行仍写着"修改"、仍提供"撤销"、徽标仍数着它、
 *  交付卡仍说"改动已验证"——那个改动在盘上已经不存在了。
 *
 *  判定按**最后一次动作**：还原之后再被写 ⇒ 重新进改动面（还原只撤掉改动，没撤掉这个文件
 *  以后再被改的资格）；只还原过、没再写 ⇒ 不在改动面。 */
export function restoredPathsOf(events: readonly AgentEvent[]): ReadonlySet<string> {
  const lastAction = new Map<string, "write" | "restore">();
  const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);
  const writes = new Map<string, string>(); // tool_call id → path
  for (const e of events) {
    if (e.type === "tool_call" && WRITE_TOOLS.has(e.name)) {
      const p = (e as { args?: { path?: unknown } }).args?.path;
      if (typeof p === "string" && p !== "") writes.set(e.id, p);
      continue;
    }
    if (e.type === "tool_result") {
      const p = writes.get(e.callId);
      if (p !== undefined) {
        writes.delete(e.callId);
        // 被拒绝/失败的一笔没有改动盘上文件（门拒绝、审批超时、工具报错都在执行前/写盘前收口）：
        // 记成 write 会让「还原」之后的文件被一笔没发生的写入重新拉回改动面。
        if (e.ok) lastAction.set(p, "write");
      }
      continue;
    }
    if (e.type === "file_restored") {
      const p = (e as { path?: unknown }).path;
      if (typeof p === "string" && p !== "") lastAction.set(p, "restore");
    }
  }
  const out = new Set<string>();
  for (const [p, kind] of lastAction) if (kind === "restore") out.add(p);
  return out;
}

/** C-32 ChangeSummaryCard 的投影（v2 输出优先）：按轮聚合写工具改动——user 行开新轮，
 *  写类 tool_call（write_file/edit_file/apply_patch）与其 tool_result 配对后计入该轮；
 *  change 字段缺席标 unknown（不猜 created/modified）；worker 子流事件已在 projectStream
 *  的过滤之外（此处直接吃原始事件，沿用同一过滤判据）。
 *  新投影在这份文件事实之上补验证券：验证拍晚于最后一次写盘才算当前证据，
 *  验证后又写盘标 stale，worker 验证不替主会话销账。 */
function collectTurnDelivery(events: readonly AgentEvent[]): InternalTurn[] {
  const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);
  const isWorker = (e: AgentEvent): boolean =>
    e.type !== "agent_spawned" && typeof (e as { agent_id?: unknown }).agent_id === "string";
  const out: InternalTurn[] = [];
  let round = 0;
  let current: InternalTurn | null = null;
  // tool_call id → { path }（写工具才登记）；tool_result 按 callId 收口并计入当前轮。
  const pendingWrites = new Map<string, { path: string }>();
  const finish = (): void => {
    if (current !== null && (current.files.length > 0 || current.verifications.length > 0)) out.push(current);
    current = null;
  };
  for (let index = 0; index < events.length; index++) {
    const e = events[index]!;
    if (isWorker(e)) continue;
    if (e.type === "user_message") {
      finish();
      round += 1;
      current = { round, files: [], lastWriteIndex: -1, verifications: [] };
      continue;
    }
    if (current === null) continue;
    if (e.type === "tool_call" && WRITE_TOOLS.has(e.name)) {
      const p = e.args.path;
      if (typeof p === "string" && p !== "") pendingWrites.set(e.id, { path: p });
      continue;
    }
    if (e.type === "tool_result") {
      const call = pendingWrites.get(e.callId);
      if (call === undefined) continue;
      pendingWrites.delete(e.callId);
      // 只有真的落盘的写入才算改动（2026-10-20 修）：gate 拒绝 / 审批超时 / 执行失败的回执
      // 同样带 path，旧实现照单全收 ⇒ 一次被拒的 write_file 会在「改动」面凭空多一行、
      // 顶栏徽标多 1、交付卡把这一轮说成「有改动未验证」——而盘上什么都没发生。
      // 它也不能推进 lastWriteIndex：否则「验证之后又写盘 ⇒ stale」会被一次没发生的写入触发。
      if (!e.ok) continue;
      current.lastWriteIndex = index;
      // 同一文件轮内多笔只记一次（首次的 change 口径）。
      if (current.files.some((f) => f.path === call.path)) continue;
      current.files.push({
        path: call.path,
        change: e.change === "created" ? "created" : e.change === "modified" ? "modified" : "unknown",
        ...(e.snapshotId !== undefined ? { snapshotId: e.snapshotId } : {}),
      });
      continue;
    }
    if (e.type === "verify_result") {
      current.verifications.push({
        index,
        ok: e.ok,
        auto: e.auto === true,
        attempt: e.attempt,
        maxAttempts: e.maxAttempts,
        results: e.results.map((r) => ({
          command: r.command,
          ok: r.ok,
          output: r.output,
          ...(r.cause !== undefined ? { cause: r.cause } : {}),
          ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
        })),
      });
    }
  }
  finish();
  return out;
}

export function turnDelivery(events: readonly AgentEvent[]): TurnDelivery[] {
  // 被显式还原过的文件退出改动面（用户明说"这一项我撤了"）。判定按**最后一次动作**：
  // 还原之后再被写 ⇒ 重新进改动面（还原只撤掉改动，没撤掉它以后再被改的资格）。
  const restored = restoredPathsOf(events);
  return collectTurnDelivery(events).map((turn) => {
    const files = turn.files.filter((f) => !restored.has(f.path));
    const fresh = turn.verifications.filter((v) => v.index > turn.lastWriteIndex);
    const latest = fresh.length > 0 ? fresh[fresh.length - 1]! : (turn.verifications[turn.verifications.length - 1] ?? null);
    const status: TurnVerificationStatus =
      files.length === 0
        ? "not-required"
        : fresh.length === 0
          ? turn.verifications.length === 0 ? "absent" : "stale"
          : latest!.ok ? "verified" : "failed";
    const unverifiedFiles = status === "verified" || status === "not-required" ? [] : files.map((f) => f.path);
    const nextAction =
      status === "failed" ? "修复失败项后重新运行验证"
      : status === "stale" ? "文件在上次验证后又有改动，请重新运行验证"
      : status === "absent" ? "本轮有文件改动但还没有验证记录，请运行验证"
      : status === "verified" ? "改动已验证，可进入审查或继续下一项"
      : "本轮没有文件改动，可继续下一项";
    return {
      round: turn.round,
      files,
      verification: {
        status,
        attempts: files.length === 0 ? turn.verifications.length : fresh.length,
        latest: latest === null ? null : {
          ok: latest.ok,
          auto: latest.auto,
          attempt: latest.attempt,
          maxAttempts: latest.maxAttempts,
          results: latest.results,
        },
      },
      unverifiedFiles,
      nextAction,
    };
  });
}

/** 批 3 交付卡流尾的条目：有交付的轮出卡，空轮出一行弱提示（连续空轮并一段）。 */
export type DeliveryTrailItem =
  | { kind: "card"; delivery: TurnDelivery }
  | { kind: "empty"; from: number; to: number };

/** 空轮弱行文案（单轮「第 N 轮」；区间「第 M–N 轮」）。 */
export function formatEmptyTrailNote(from: number, to: number): string {
  return from === to ? `第 ${String(from)} 轮 · 无文件改动` : `第 ${String(from)}–${String(to)} 轮 · 无文件改动`;
}

/** 交付卡流尾序列（批 3 · 文档阶段 3·对话页①）：按轮序把「有交付的卡」与「空轮弱行」交错铺开，
 *  连续空轮合并为一段（第 M–N 轮）。`currentRoundRunning` = 末轮还在跑：即便它此刻没有交付也
 *  不预告弱行——轮还没收束，「无文件改动」断言不成立（写盘随时可能发生）；末轮已有交付时卡照出
 *  （live 卡与运行中流式并存是既有行为）。总轮数取 max(totalRounds, 末卡轮号) 防御失配。 */
export function deliveryTrail(
  deliveries: readonly TurnDelivery[],
  totalRounds: number,
  currentRoundRunning: boolean,
): DeliveryTrailItem[] {
  const byRound = new Map<number, TurnDelivery>();
  for (const d of deliveries) byRound.set(d.round, d);
  const last = deliveries.length > 0 ? deliveries[deliveries.length - 1]!.round : 0;
  const total = Math.max(totalRounds, last);
  const out: DeliveryTrailItem[] = [];
  let emptyFrom: number | null = null;
  const flushEmpty = (end: number): void => {
    if (emptyFrom !== null) out.push({ kind: "empty", from: emptyFrom, to: end });
    emptyFrom = null;
  };
  for (let r = 1; r <= total; r++) {
    const card = byRound.get(r);
    if (card !== undefined) {
      flushEmpty(r - 1);
      out.push({ kind: "card", delivery: card });
      continue;
    }
    if (r === total && currentRoundRunning) { flushEmpty(total - 1); break; } // 运行中末轮不预告（见上注）
    emptyFrom ??= r;
  }
  flushEmpty(total);
  return out;
}

export function turnChanges(events: readonly AgentEvent[]): Array<{
  round: number;
  files: TurnDelivery["files"];
}> {
  return turnDelivery(events)
    .filter((t) => t.files.length > 0)
    .map((t) => ({ round: t.round, files: t.files }));
}
