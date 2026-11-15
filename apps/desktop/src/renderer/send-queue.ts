// v2.17 运行中可沟通：发送队列（渲染层内存态，按会话各一条表）。
// 四条语义各一个出口，组件与 App 不各算一份：
//   takeQueued    本轮收束后取队首（FIFO；空队列给 null，调用方据此停表）
//   promoteQueued 把某条提到队首（「打断并发送」：先改序再打断，收束后先发的就是它）
//   dropQueued    按位移除
//   editQueued    改一条的正文（附件/次序不动；空文本不落地）
//   moveQueued    上/下移一条（键盘可达的排序，不靠拖拽）
// 为什么是纯函数：本仓没有 jsdom（见 render-structure.test.tsx 头注），交互逻辑一律抽成
// 纯函数判卷 + 组件走 SSR 结构判卷两面。
import type { RunAttachmentReference, SessionQueueEntry } from "../../../../src/main/ipc-protocol";

export interface QueuedSend {
  /** 渲染键（进程内自增；只有消息内容落盘，渲染键不落盘）。 */
  id: number;
  text: string;
  attachments: RunAttachmentReference[];
  /** 占位（第 1206 页）：`/goal` 的 setGoal 还没落定，这条已经在队首但**还不能派**。
   *  不占位的话，setGoal 等待期间旧轮自然收束，收束链会把老队首先派出去——⌘↩ 要发的这条
   *  反而排在后面。占位只在内存里，不落盘（落盘后标志会丢，重启后会把没设目标的消息派出去）。 */
  blocked?: boolean;
}

/** 本轮收束后出队：队首派下一轮，rest 回写。空队列 head=null。
 *  队首是占位（`blocked`）时给 null 且**不出队**：收束链在这里停一拍，等 setGoal 落定后
 *  由 sendWithGoal 清掉占位并显式续派（第 1206 页）。 */
export function takeQueued(list: readonly QueuedSend[]): { head: QueuedSend | null; rest: QueuedSend[] } {
  if (list.length === 0) return { head: null, rest: [] };
  if (list[0]?.blocked === true) return { head: null, rest: [...list] };
  return { head: list[0] ?? null, rest: list.slice(1) };
}

/** 入队：默认排到队尾（「加入队列」/运行中回车）；`front` 插到队首。
 *  为什么需要这个分岔：⌘↩ 的标签是「打断并发送」——用户要发的是**手里这一条**，
 *  旧实现一律追加到队尾，打断后先派出去的是之前排的老消息（用户看到自己刚打的字没动）。
 *  与队列条的「立即」同一条语义：先把它放队首，再打断。 */
export function enqueueQueued(list: readonly QueuedSend[], item: QueuedSend, front = false): QueuedSend[] {
  return front ? [item, ...list] : [...list, item];
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

/** 改一条排队消息的正文：只换 text（附件、id、次序不动）。空文本/越界原样返回——
 *  队列里没有「发一条空消息」这种东西，清空输入不该把条目变成哑弹。 */
export function editQueued(list: readonly QueuedSend[], index: number, text: string): QueuedSend[] {
  const trimmed = text.trim();
  if (trimmed === "" || index < 0 || index >= list.length) return [...list];
  return list.map((item, i) => (i === index ? { ...item, text: trimmed } : item));
}

/** 上移(-1)/下移(+1)一条：越界或原地不动原样返回（ends 不交换成空）。 */
export function moveQueued(list: readonly QueuedSend[], index: number, delta: -1 | 1): QueuedSend[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const picked = out.splice(index, 1)[0];
  if (picked === undefined) return [...list];
  out.splice(to, 0, picked);
  return out;
}

/** 落盘载荷只保留用户消息本身；id 与占位旗是渲染态，不进磁盘。 */
export function toSessionQueueEntries(list: readonly QueuedSend[]): SessionQueueEntry[] {
  return list.filter((item) => item.blocked !== true).map((item) => ({ text: item.text, attachments: [...item.attachments] }));
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
  takeNext: () => QueuedSend | null | Promise<QueuedSend | null>,
): Promise<void> {
  let next: { text: string; attachments: RunAttachmentReference[] } | null = first;
  while (next !== null) {
    const keepGoing = await run(next);
    if (!keepGoing) return;
    next = await takeNext();
  }
}

/** 运行中按回车/发送时，这条消息该走哪条路（第 9 点·轮中插话，2026-10-23）。
 *
 *  三条路，语义相反，**必须先判再发**：
 *   · `steer`    —— 送进正在跑的那一轮（不新开 run、不改轮次）；
 *   · `queue`    —— 排到本轮结束后自动发（用户明确要排队，或主进程说「不在运行」，或带附件）；
 *   · `run`      —— 空闲，起新一轮。
 *
 *  为什么抽成纯函数：这段判据原本内联在 `send()` 里，被「会话是否运行中」与「主进程怎么答」
 *  两层状态各切一刀，而**离屏界面根本立不住那个状态**（第 681 页记的冒烟失败）。
 *  把它做成纯函数，三条路的分岔就能不依赖 DOM/运行态被钉死，`send()` 只负责执行。
 *
 *  `forceQueue` 是用户显式意图（点「加入队列」钮）：按钮写着「加入队列」却把话插进当前轮，
 *  就是按钮在说谎——所以它的优先级高于一切插话条件。
 *  附件同理：附件要过引用校验与装载，属下一轮的入口，半路塞进当前轮会把校验绕开。 */
export function steerRouteOf(input: {
  /** 当前是否有活动会话；空屏（null）只可能是起新一轮。 */
  sessionId: string | null;
  /** 渲染层的运行集判据（真值来源见 run-queue 的 keyOf）。 */
  running: boolean;
  /** 用户显式要求排队（「加入队列」钮）。 */
  forceQueue: boolean;
  /** 本条消息带来的附件数。 */
  attachmentCount: number;
}): "run" | "queue" | "steer" {
  if (input.sessionId === null) return "run";
  if (!input.running) return "run";
  if (input.forceQueue) return "queue";
  if (input.attachmentCount > 0) return "queue";
  return "steer";
}

/** 主进程对 `runSteer` 的应答是否等于「真送进去了」（决定要不要落回入队）。 */
export function steerAccepted(res: { ok?: boolean }): boolean {
  // 只认 `ok === true`：协议兜底/桩兜底给 `{}` 时是 `undefined`，
  // 那必须当成"没送进去"并回落入队——把 undefined 读成成功就是**吞消息**。
  return res.ok === true;
}

/** 一条消息的去向：插话 / 入队 / 起跑 / 没能派出去。 */
export type SendDisposition = "steered" | "queued" | "started" | "failed";

/** ⌘↩「打断并发送」的打断时点（第 1206 页）：**这条消息真的排进队列之后**才打断。
 *
 *  普通发送在 onSend 返回前就已同步入队（返回 undefined）⇒ 当场打断，和以前一样。
 *  `/goal` 要先 `await setGoal` 才能入队（返回 Promise）⇒ 等它落定，且只在 `queued` 时打断：
 *   · 早打断（旧行为）：收束链先把**老队首**派出去，用户刚打的这条反而排在后面；
 *   · 空闲时 setGoal 期间旧 run 自然收束、这条已起跑：再打断就是把它自己杀掉。
 *  失败（`failed`）不打断：消息没出去，草稿已还回输入框，没有理由再毁掉在跑的活。 */
export function interruptAfterSend(dispatched: void | Promise<SendDisposition>, cancel: () => void): void {
  if (dispatched === undefined) { cancel(); return; }
  void dispatched.then((disposition) => { if (disposition === "queued") cancel(); }, () => undefined);
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
 *  会话读取失败先要求恢复；其余优先级 = 门（要你做决定）> 队列读回 > 创建会话。
 *  **运行中不在这里**——运行中输入可用（回车排队、⌘↩ 打断并发送）。
 *  ask（审批）门不进 gateActive：卡在场时输入保持可用（v2.17 口径，v2.18 沿用）。 */
export type ComposerLockReason = "gate" | "queue" | "creating" | "session";

export function composerLockReason(input: {
  /** 读回发送队列的瞬时加载（App 侧原本以 disabled 的第三项独立 OR 进来）。 */
  queueLoading?: boolean;
  /** 正文或队列读取失败；请求结束不等于会话已就绪。 */
  sessionLoadFailed?: boolean;
  creating: boolean;
  gateActive: boolean;
}): ComposerLockReason | null {
  if (input.sessionLoadFailed === true) return "session";
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
