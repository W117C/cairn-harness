// v2.17 运行中可沟通：发送队列（渲染层内存态，按会话各一条表）。
// 三条语义各一个出口，组件与 App 不各算一份：
//   takeQueued    本轮收束后取队首（FIFO；空队列给 null，调用方据此停表）
//   promoteQueued 把某条提到队首（「打断并发送」：先改序再打断，收束后先发的就是它）
//   dropQueued    按位移除
// 为什么是纯函数：本仓没有 jsdom（见 render-structure.test.tsx 头注），交互逻辑一律抽成
// 纯函数判卷 + 组件走 SSR 结构判卷两面。
import type { RunAttachmentReference, SessionQueueEntry } from "../../../../src/main/ipc-protocol";

export interface QueuedSend {
  /** 渲染键（进程内自增；队列不落盘——沿用渲染层内存态纪律）。 */
  id: number;
  text: string;
  attachments: RunAttachmentReference[];
}

/** 本轮收束后出队：队首派下一轮，rest 回写。空队列 head=null。 */
export function takeQueued(list: readonly QueuedSend[]): { head: QueuedSend | null; rest: QueuedSend[] } {
  if (list.length === 0) return { head: null, rest: [] };
  return { head: list[0] ?? null, rest: list.slice(1) };
}

/** 「打断并发送」：把第 index 条提到队首。越界原样返回（调用点按 index 渲染，越界=坏拍不放大）。 */
export function promoteQueued(list: readonly QueuedSend[], index: number): QueuedSend[] {
  if (index < 0 || index >= list.length) return [...list];
  const out = [...list];
  const picked = out.splice(index, 1)[0];
  if (picked === undefined) return [...list];
  out.unshift(picked);
  return out;
}

/** 按位移除；越界原样返回。 */
export function dropQueued(list: readonly QueuedSend[], index: number): QueuedSend[] {
  if (index < 0 || index >= list.length) return [...list];
  return list.filter((_, i) => i !== index);
}

/** 落盘载荷只保留用户消息本身；id 是渲染态，不进磁盘。 */
export function toSessionQueueEntries(list: readonly QueuedSend[]): SessionQueueEntry[] {
  return list.map((item) => ({ text: item.text, attachments: [...item.attachments] }));
}

/** 读回 sidecar 时重建渲染 id；nextId 由 App 的会话内单调序号提供。 */
export function fromSessionQueueEntries(entries: readonly SessionQueueEntry[], nextId: () => number): QueuedSend[] {
  return entries.map((entry) => ({ id: nextId(), text: entry.text, attachments: [...entry.attachments] }));
}

/** 顺序派发（「本轮收束后自动派下一条」的唯一实现）：
 *  first 起，每轮 run 收束后取队首续派，直到队空或 run 报 false（本轮失败——剩余队列留在表里，
 *  不吞不掉，下一条要等用户处理）。一次只 await 一条：同会话并发 run 会被 core 拒，这里不制造它。
 *  takeNext 由调用方提供（App 从 per-session 表出队并回写）；本函数不碰状态。 */
export async function drainQueue(
  first: { text: string; attachments: RunAttachmentReference[] },
  run: (msg: { text: string; attachments: RunAttachmentReference[] }) => Promise<boolean>,
  takeNext: () => QueuedSend | null,
): Promise<void> {
  let next: { text: string; attachments: RunAttachmentReference[] } | null = first;
  while (next !== null) {
    const keepGoing = await run(next);
    if (!keepGoing) return;
    next = takeNext();
  }
}

/** 一轮 run 收束后是否继续派队列：用户打断是正常收束，真实失败才停表。 */
export function continueAfterRun(res: { ok: boolean; aborted?: boolean }): boolean {
  return res.ok || res.aborted === true;
}

/** 「打断/停止」点击后的陈旧旗自愈判据（第十三遍）：main 答 {ok:false}（该会话无在跑 controller）
 *  ＝本实例的「运行中」是陈旧旗（旧 main 无收束推送时代的残影 / 整页重载前的孤儿标记）——
 *  旧代码 void 掉结果，点了像没点（业主实测「排队中·打断并发送，点击没有反应」）。可摘三道闸：
 *  ① cancelOk=true ⇒ 真打断了一场 run（正常收束链自会续派）不摘；
 *  ② 点击后 runGen 已动 ⇒ 收束链已把队列先派起来（同拍竞态），那是真在跑，不碰；
 *  ③ 旗已不在 ⇒ 收束链已自行摘掉，无事可做。
 *  纯函数：全是入参，不含时钟与全局。 */
export function shouldHealStaleRun(args: {
  cancelOk: boolean;
  genAtClick: number;
  genNow: number;
  flagPresent: boolean;
}): boolean {
  if (args.cancelOk) return false;
  if (args.genNow !== args.genAtClick) return false;
  if (!args.flagPresent) return false;
  return true;
}

/** Composer 锁因（2026-10-18 收口）：同一个 disabled 布尔此前被 Composer 拿去猜占位文案，
 *  于是「澄清/方案门未决」被写成「正在创建会话…」——禁用是真的，原因说错了。
 *  优先级 = 用户越需要处理的越靠前：门（要你做决定）> 队列读回（一闪而过的加载）> 创建会话。
 *  **运行中不在这里**——运行中输入可用（回车排队、⌘↩ 打断并发送）。
 *  ask（审批）门不进 gateActive：卡在场时输入保持可用（v2.17 口径，v2.18 沿用）。 */
export type ComposerLockReason = "gate" | "queue" | "creating";

export function composerLockReason(input: {
  /** 读回发送队列的瞬时加载（App 侧原本以 disabled 的第三项独立 OR 进来）。 */
  queueLoading?: boolean;
  creating: boolean;
  gateActive: boolean;
}): ComposerLockReason | null {
  if (input.gateActive) return "gate";
  if (input.queueLoading === true) return "queue";
  if (input.creating) return "creating";
  return null;
}

export function composerLocked(input: { creating: boolean; gateActive: boolean }): boolean {
  return composerLockReason(input) !== null;
}

/** 审批卡归属判定（v2.18 唯一处）：这张卡该不该画在**当前会话**的头上。
 *  此前 App 只有单一 `ask` 态 ⇒ 谁最后发卡谁上屏，跨会话会串台；core 侧给卡带上 sessionId
 *  之后（IPC v3），这里成了唯一的筛子——不再是「有没有卡」，是「这张卡是不是本会话的」。
 *  缺席 sessionId（老载荷／headless 路径）＝ **归属未知**：照旧显示（不静默吞卡，
 *  否则headless 面永远出不了卡），但也因此不参与任何按会话的回答与锁定。 */
export function askBelongsToSession(payload: { sessionId?: string } | null, activeId: string | null): boolean {
  if (payload === null) return false;
  const sid = payload.sessionId ?? "";
  if (sid === "") return true; // 未知 ⇒ 沿用旧行为，不猜也不吞
  return sid === (activeId ?? "");
}

/** 会话结束自动沉淀的合并审批（agent-runner 双轨②，agent-runner.ts:1492 送审形状）：
 *  distill 的合并审批 args 带 trigger 标记；手打记忆写入的普通审批同为 tool=remember
 *  但 args 无 trigger——两者必须分开（后者是用户主动要求写记忆，照常弹卡）。
 *  「对话优先跳沉」的唯一判据（App 的 onAsk 队列在场即拒 / send 运行中即拒），
 *  别处不得复制这份字符串比较。 */
export function isSessionEndDistillAsk(p: { tool?: string; args?: Record<string, unknown> }): boolean {
  return p.tool === "remember" && p.args?.trigger === "session_end_distill";
}
