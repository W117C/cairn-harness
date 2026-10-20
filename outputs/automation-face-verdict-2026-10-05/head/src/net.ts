// M0 复盘 根因 4：出网调用统一超时设施。
//
// 背景：三个 provider 适配器、更新检查、MCP 连接此前**都不带任何超时**——
// 对端挂起时 fetch 永不 settle → IPC promise 悬空（UI 永久转圈）；
// provider 网络停滞 → agent loop 卡死，且因为「轮界才检查 abort」，连取消都救不回来。
//
// 为什么不用 `AbortSignal.timeout()`：它是**总时长**上限。而 LLM 流式生成合法地
// 可持续数分钟（长回答 / 大工具参数 / 慢思考），总时长超时会把正常请求杀掉。
// 这里真正要防的是**停滞**——建连后长时间零分片（对端挂起 / 中间设备黑洞）。
// 故用「每次收到分片就续期」的看门狗：静默超过 windowMs 才 abort。
//
// 两种设施各司其职：
//   stallGuard   —— 流式（SSE）用：静默窗口，可续期。
//   withTimeout  —— 一次性请求（MCP connect / listTools）用：总时长语义本就正确。
//
// 本模块只被主进程侧消费（providers / main / agent.plugins），不进 renderer。

/** 默认静默窗口：60s 无任何分片即判停滞。 */
export const DEFAULT_STALL_MS = 60_000;

export interface StallGuard {
  /** 传给 fetch / SDK 的 signal。 */
  readonly signal: AbortSignal;
  /** 收到数据 → 续期（重置静默窗口）。 */
  bump(): void;
  /** 收束：清掉看门狗。**必须**在 finally 里调用，否则定时器泄漏。 */
  dispose(): void;
  /** 是否已因停滞而 abort（供上层区分「停滞」与「对端报错」）。 */
  stalled(): boolean;
}

/**
 * 建一个停滞看门狗。
 * @param windowMs 静默窗口；<=0 或非有限值 = 关闭守卫（测试/显式关闭用）。
 * @param label    错误文案里的调用名（如 "GLM"、"更新源"）。
 */
export function stallGuard(windowMs: number = DEFAULT_STALL_MS, label = "出网调用"): StallGuard {
  const controller = new AbortController();
  const enabled = Number.isFinite(windowMs) && windowMs > 0;
  let hit = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    if (!enabled) return;
    timer = setTimeout(() => {
      hit = true;
      // 以 Error 作 abort reason：fetch 与 body reader 都会用它作为拒绝值，
      // 上层无需翻译即可拿到可读原因（fail-visible，不吞成 "The operation was aborted"）。
      controller.abort(new Error(`${label} 停滞超时：${String(windowMs)}ms 内无任何数据（对端挂起或网络黑洞）`));
    }, windowMs);
    // 看门狗自身不应把进程钉在事件循环上（否则单测里会挂住 worker）。
    (timer as { unref?: () => void }).unref?.();
  };

  const disarm = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  arm();

  return {
    signal: controller.signal,
    bump(): void {
      if (hit) return; // 已判停滞：不再续命，让 abort 生效
      disarm();
      arm();
    },
    dispose(): void {
      disarm();
    },
    stalled(): boolean {
      return hit;
    },
  };
}

/**
 * 给一次性 promise 加总时长上限（MCP connect / listTools 用；非流式，总时长语义本就合适）。
 * 超时**不**取消底层操作（调用方负责 close 掉连接），只让等待方 fail-visible 地收束。
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时：${String(ms)}ms 内未完成`)), ms);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface BodyRead {
  /** 已读到的正文（按 UTF-8 逐块解码，跨块的多字节字符不会被切成 U+FFFD）。 */
  text: string;
  /** 实际读到的字节数。 */
  bytes: number;
  /** 是否撞了 cap 而提前收束。**不抛**——两种语义各有各的消费者：
   *  版本 manifest 超 1MB 是异常（调用方该判失败），网页正文超帽只是"这个页面很长"（截断后仍有价值）。 */
  capped: boolean;
}

/** 流式读响应体，超过 cap 就停。`Content-Length` 先帽（能省掉一次白读的传输），
 *  真流起来再逐块计数并 `guard.bump()`（进展即续命：慢而有进展的响应体不该被一次性定时器误杀）。
 *  原先私有于 `src/main/updater.ts`，搬到这里是因为 `src/tools/` 也要用——让工具反向 import
 *  `main/` 是把装配层压进内核，方向反了。 */
export async function readBodyCapped(res: Response, cap: number, guard?: StallGuard): Promise<BodyRead> {
  const declared = Number(res.headers?.get?.("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > cap) {
    throw new Error("body 超上限");
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return { text, bytes: Buffer.byteLength(text, "utf8"), capped: false };
  }
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    guard?.bump();
    if (bytes > cap) {
      void reader.cancel().catch(() => {});
      return { text, bytes, capped: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  // 收尾那一次 decode：把还挂在解码器里的延续字节吐出来（流末尾常有一个不完整块）。
  return { text: text + decoder.decode(), bytes, capped: false };
}
