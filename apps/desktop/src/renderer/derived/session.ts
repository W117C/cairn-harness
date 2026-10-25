// 派生层·会话面（纯投影）：事件流 → 会话/轮/可见文本。
// I3 契约：只吃 AgentEvent[]，只吐值；不读时钟、不取随机、不做 IO、不留模块级可变态。
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";

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

/** 事件 id（1-based 行号，assistant 行 eventId 同口径）→ 所属轮号（1-based）。P3-1 分叉的
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

/** 第 N 轮的用户输入原文（编辑并重发要用）。拿不到 → null，不编。 */
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
