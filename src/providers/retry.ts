// 出网建连重试（能力 4「遇到失败能重试、换路径」+ 能力 9 运维面）。
// 此前三家 provider 的建连段是逐字同构的一段代码，且**零重试**：真实负载下首个 429/5xx
// 或一次网络抖动就把整轮任务打死（AGENTS.md 记过 provider:check 联网分支长期未证，正是这条路）。
import { DEFAULT_STALL_MS, stallGuard, type StallGuard } from "../net";

/** signal-aware sleep（2026-10-18）：本模块经 provider-draft → provider-config → registry 被
 *  renderer 引用（浏览器 bundle）。`node:timers/promises` 在浏览器侧被 externalize 成空模块，
 *  构建直接失败（"setTimeout is not exported by __vite-browser-external"）。语义与原实现一致：
 *  到点 resolve；中途 abort 则 clearTimeout 并 reject（上层 catch 仍以 callerSignal 原始原因优先）。 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortError = (): Error => (signal?.reason instanceof Error ? signal.reason : new Error("Aborted"));
    if (signal?.aborted === true) { reject(abortError()); return; }
    const onAbort = (): void => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export { delay as waitRetryDelay };

/** 可重试的对端状态码：限流 / 服务器侧临时故障 / 请求超时。
 *  400/401/403/404/422 是**请求本身**的问题，重放只会再错一次并白烧预算 ⇒ 不在此列。 */
export function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/** Retry-After → 毫秒（支持「秒数」与 HTTP-date 两种形态）；不可解析返回 null。上限 capMs 钳住。 */
export function retryAfterMs(header: string | null | undefined, nowMs: number, capMs: number): number | null {
  if (header === null || header === undefined) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;
  const secs = Number(trimmed);
  if (Number.isFinite(secs)) return Math.min(Math.max(0, Math.round(secs * 1000)), capMs);
  const when = Date.parse(trimmed);
  if (!Number.isFinite(when)) return null;
  return Math.min(Math.max(0, Math.round(when - nowMs)), capMs);
}

/** 指数退避 + full jitter（AWS 口径）：同批 worker 齐步重试会把限流窗口二次打满。
 *  attempt 从 1 起 ⇒ 第 1 次重试上限 base、第 2 次 2·base、第 3 次 4·base，封顶 capMs。 */
export function backoffMs(attempt: number, baseMs: number, capMs: number, rand: () => number): number {
  const cap = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.max(0, Math.min(cap, Math.floor(cap * rand())));
}

export interface EstablishOptions {
  label: string;
  url: string;
  /** 不含 signal 的请求参数——signal 由本函数按「看门狗 + 会话取消」合成。 */
  init: RequestInit;
  fetchImpl?: typeof fetch;
  stallMs?: number;
  callerSignal?: AbortSignal;
  /** 总尝试次数（含首次）。缺省 3。 */
  attempts?: number;
  baseDelayMs?: number;
  capDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  /** 每次重试的可见回调（fail-visible：静默重试等于把故障藏起来）。 */
  onRetry?: (info: { attempt: number; status: number | null; delayMs: number; reason: string }) => void;
}

export interface Established {
  res: Response;
  /** 成功建连后**交还给调用方**的看门狗——流体生命周期仍归调用方管（bump / dispose）。 */
  guard: StallGuard;
}

/** 错误正文只用于 300 字符诊断；读取有限前缀，并在每块进展上续期。
 *  长度头超限仍要保留前缀，所以不走会按 Content-Length 拒绝的 readBodyCapped。 */
async function readErrorPrefix(res: Response, guard: StallGuard): Promise<string> {
  guard.bump();
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const decoder = new TextDecoder();
  const maxBytes = 4_096;
  let bytes = 0;
  let text = "";
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > 0) guard.bump();
      const prefix = value.subarray(0, maxBytes - bytes);
      text += decoder.decode(prefix, { stream: true });
      bytes += prefix.byteLength;
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** 建立一次流式请求，只重试「响应体尚未被消费」的失败：网络错误 / 429 / 5xx。
 *  一旦 `res.ok` 就交回调用方，**绝不重放**——流已开始产出后重试会把同一轮 delta 吐两遍
 *  （比失败更糟：模型看到重复内容）。
 *  停滞（`guard.stalled()`）不重试：那是 60s 量级的等待，重试三次等于白挂三分钟，
 *  直接把可读原因抛回上层（stallGuard 以 Error 作 abort reason，上层无需翻译）。
 *  调用方取消也不重试（那是用户意图，不是故障）。 */
export async function establishStream(o: EstablishOptions): Promise<Established> {
  const doFetch = o.fetchImpl ?? fetch;
  const attempts = Math.max(1, Math.floor(o.attempts ?? 3));
  const baseMs = o.baseDelayMs ?? 500;
  const capMs = o.capDelayMs ?? 8_000;
  const sleep = o.sleep ?? (async (ms: number): Promise<void> => {
    try { await delay(ms, o.callerSignal); }
    catch (err) {
      // timers/promises 抛包装后的 AbortError；向上保留会话的原始取消原因。
      o.callerSignal?.throwIfAborted();
      throw err;
    }
  });
  const rand = o.rand ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    o.callerSignal?.throwIfAborted();
    const guard = stallGuard(o.stallMs ?? DEFAULT_STALL_MS, o.label);
    const signal = o.callerSignal !== undefined ? AbortSignal.any([guard.signal, o.callerSignal]) : guard.signal;
    let res: Response;
    try {
      // 不跟随重定向：undici 默认 follow，而 provider 请求带完整会话正文；对端一个
      // `307 Location: http://169.254.169.254/...` 就能把正文发到内网（web_fetch 早已逐跳校验）。
      // 重定向端点请把 baseURL 直接配成最终地址。
      res = await doFetch(o.url, { redirect: "manual", ...o.init, signal });
    } catch (err) {
      guard.dispose(); // 建连阶段失败：看门狗不能留下
      const cancelled = o.callerSignal?.aborted === true || (err instanceof Error && err.name === "AbortError");
      if (cancelled || guard.stalled() || attempt >= attempts) throw err;
      const delay = backoffMs(attempt, baseMs, capMs, rand);
      o.onRetry?.({ attempt, status: null, delayMs: delay, reason: err instanceof Error ? err.message : String(err) });
      o.callerSignal?.throwIfAborted();
      await sleep(delay);
      continue;
    }
    if (res.ok) return { res, guard };
    let text = "";
    try { text = await readErrorPrefix(res, guard); }
    catch { /* 正文读取失败时仍保留 HTTP 状态；取消和停滞由下面的 signal 还原。 */ }
    finally { guard.dispose(); }
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `${o.label} 端点返回 HTTP ${String(res.status)} 重定向（已拒绝跟随：防止把请求正文发往未校验的地址；` +
        "请把 baseURL 直接指向最终地址）",
      );
    }
    if (!retryableStatus(res.status) || attempt >= attempts || o.callerSignal?.aborted === true || guard.stalled()) {
      signal.throwIfAborted();
      // 文案与既有三家逐字同构（多条测 / 门禁按 `${label} 请求失败 HTTP <status>` 断言）
      throw new Error(`${o.label} 请求失败 HTTP ${String(res.status)}: ${text.slice(0, 300)}`);
    }
    const headerMs = retryAfterMs(res.headers?.get?.("retry-after") ?? null, Date.now(), capMs);
    const delay = headerMs ?? backoffMs(attempt, baseMs, capMs, rand);
    o.onRetry?.({ attempt, status: res.status, delayMs: delay, reason: text.slice(0, 200) });
    o.callerSignal?.throwIfAborted();
    await sleep(delay);
  }
}
