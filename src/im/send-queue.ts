// IM 发送队列（2026-11-18 从 host.ts 拆出；第 1327/1328 页排期项）。
//
// 为什么单独立文件：队列机器在 host.ts 里一个模块贡献了 3 个缺陷（两条静默丢消息的路
// + 一条幂等键失效），而拆它只碰一个判卷文件、只走公开 API（第 1328 页反方复核裁决）。
// 状态机边界（连接窗口期 / 重试 / 停靠）集中在这一个文件：「谁丢了我的消息」从此只有一个答案处。
//
// 队列纪律（改这里前先读）：
// 1. 键跟着 job 走：幂等键入队时定死（host 的 sendTo 造键），重试复用同一条 job 的同一个键。
//    微信据此按分片派生 client_id；每次尝试重新生成 = 平台去重失效，重试即重复投递。
// 2. 窗口期不丢：槽位已占但连接未就绪（ready=false）时 drain 停住，job 留在队头；
//    就绪那一拍由宿主 kick（见 kick），不是丢、不是立刻失败。
// 3. retry 停靠：重连（park→adopt）不丢待发队列；只有 remove（连接真删）才把停靠队列一并丢弃
//    （dropParked）。stop（禁用）丢弃活跃队列——这是刻意的：禁用期间产生的回信没有归宿，
//    复活连接后补发旧回信是把过期事实当新消息送出去；要补发走 retry 的停靠路。
// 4. 如实落账：permanent（4xx 除 429）或达上限时经 onExhausted 如实上报（宿主映射成
//    状态面 error，保留现有 state）；不静默吞掉。
import type { ImChat } from "./types";

const SEND_RETRY_MS = 5_000;
const SEND_MAX_ATTEMPTS = 5;

/** 一条待发 job：键在入队时定死（见纪律 1）；attempts 只由 drain 推进。 */
export interface SendJob {
  chat: ImChat;
  text: string;
  attempts: number;
  key?: string;
  after?: (sent: { messageId?: string }) => void;
}

/** 宿主注入面：host 持有 runners 与适配器，队列只认三个回调。 */
export interface SendQueueDeps {
  /** 交一条 job 给当前适配器发送。只在 ready(connId) 为 true 时被调用。 */
  deliver: (connId: string, job: SendJob) => Promise<{ messageId?: string }>;
  /** 连接是否就绪（槽位已连）。窗口期为 false ⇒ drain 停住等 kick。 */
  ready: (connId: string) => boolean;
  /** 一条 job 耗尽重试时如实上报；宿主映射成状态面 error（保留现有 state）。 */
  onExhausted: (connId: string, message: string) => void;
  /** 可重试失败的重试间隔（毫秒）。缺省 5s；判卷注入小值。 */
  retryMs?: number;
  /** 单条 job 的尝试上限。缺省 5。 */
  maxAttempts?: number;
}

interface ChatQueue {
  jobs: SendJob[];
  retryTimer: ReturnType<typeof setTimeout> | null;
}

/** 按连接、按聊天的发送队列。不持有适配器、不持有存储——状态机边界集中在这一个文件，
 *  「谁丢了我的消息」从今往后只有一个答案处。 */
export function createSendQueues(deps: SendQueueDeps) {
  const active = new Map<string, Map<string, ChatQueue>>();
  const parked = new Map<string, Map<string, ChatQueue>>();

  const failClass = (error: unknown): "permanent" | "retry" => {
    const e = error as { permanent?: boolean; status?: number } | null;
    if (e !== null && e !== undefined && typeof e === "object") {
      if (e.permanent === true) return "permanent";
      if (typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.status !== 429) return "permanent";
    }
    return "retry";
  };

  const drain = async (connId: string, chatKey: string): Promise<void> => {
    const queues = active.get(connId);
    const queue = queues?.get(chatKey);
    if (queues === undefined || queue === undefined) return;
    while (queue.jobs.length > 0) {
      if (!deps.ready(connId)) return; // 窗口期：槽位已占、连接未就绪，job 留队头等 kick
      const job = queue.jobs[0]!;
      try {
        const sent = await deps.deliver(connId, job);
        queue.jobs.shift();
        job.after?.(sent);
      } catch (error) {
        job.attempts += 1;
        const max = deps.maxAttempts ?? SEND_MAX_ATTEMPTS;
        if (failClass(error) === "permanent" || job.attempts >= max) {
          queue.jobs.shift();
          deps.onExhausted(connId, `回信失败：${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        // retryable：整队停住等重试
        if (queue.retryTimer !== null) clearTimeout(queue.retryTimer);
        queue.retryTimer = setTimeout((): void => {
          queue.retryTimer = null;
          void drain(connId, chatKey);
        }, deps.retryMs ?? SEND_RETRY_MS);
        return;
      }
    }
  };

  const drainAllForConn = (connId: string): void => {
    const queues = active.get(connId);
    if (queues === undefined) return;
    for (const chatKey of [...queues.keys()]) {
      if ((queues.get(chatKey)?.jobs.length ?? 0) > 0) void drain(connId, chatKey);
    }
  };

  return {
    /** 入队（FIFO）。队列从空变非空那一拍 kick 一拍 drain；窗口期 job 留队头。 */
    enqueue(connId: string, chatKey: string, job: SendJob): void {
      let queues = active.get(connId);
      if (queues === undefined) {
        queues = new Map();
        active.set(connId, queues);
      }
      let queue = queues.get(chatKey);
      if (queue === undefined) {
        queue = { jobs: [], retryTimer: null };
        queues.set(chatKey, queue);
      }
      queue.jobs.push(job);
      if (queue.jobs.length === 1) void drain(connId, chatKey);
    },

    /** 建连就绪那一拍，把这条连接所有非空队列都 kick 一拍（连接窗口期补发，第 1327 页修法）。 */
    kick(connId: string): void {
      drainAllForConn(connId);
    },

    /** 重连前停靠：把活跃队列移进停靠区并清掉重试定时器（原 retry() 语义）。 */
    park(connId: string): void {
      const queues = active.get(connId);
      if (queues === undefined || queues.size === 0) return;
      for (const queue of queues.values()) {
        if (queue.retryTimer !== null) {
          clearTimeout(queue.retryTimer);
          queue.retryTimer = null;
        }
      }
      parked.set(connId, queues);
      active.delete(connId);
    },

    /** start 时取回停靠队列（有则原样接手，无则惰性新建——enqueue 会造）。 */
    adopt(connId: string): void {
      const q = parked.get(connId);
      if (q !== undefined) {
        parked.delete(connId);
        active.set(connId, q);
      }
    },

    /** stop：清定时器 + 丢弃活跃队列（禁用路；停靠的不动）。 */
    drop(connId: string): void {
      const queues = active.get(connId);
      if (queues === undefined) return;
      for (const queue of queues.values()) {
        if (queue.retryTimer !== null) {
          clearTimeout(queue.retryTimer);
          queue.retryTimer = null;
        }
      }
      active.delete(connId);
    },

    /** remove：连接真删，停靠队列一并丢弃。 */
    dropParked(connId: string): void {
      parked.delete(connId);
    },
  };
}
