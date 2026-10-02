// 基准跑器的「被 provider 打断 ⇒ 要不要重拨」那一格（2026-10-02）。
//
// 缘起（现读，不是推测）：`--reps 3` 那 36 趟里 **32 趟 0 请求**，报的都是
// `HTTP 429 … free-models-per-day-stealth`，而同一条错误体里带着
// `X-RateLimit-Reset: 1790985600000` ⇒ 「跑不成」与「模型没做到」被混在同一格读数里。
// 分母那一半已经由 `eval-validity.runValidity` 修好了；这一半管的是**要不要再拨一次**，
// 以及**重拨不成时怎么说清为什么没重拨**。
//
// 三条纪律：
//  ⑴ 只有 provider 侧打断值得重拨。模型自己干坏事（改了判卷面、verify 没过）不重拨——
//     那是被度量的行为，重试等于给它第二次机会刷分（同 `runValidity` 的第二向）。
//  ⑵ 等待要有帽。日配额那种「要等到明天」的 reset **不在帽内** ⇒ 明确判「不重拨」并给出原因，
//     而不是让跑器睡到被外层超时杀掉（本仓 `mutate-verify` 就为这类超时留过警）。
//  ⑶ 判据与 `runValidity` 共用同一个决策点（`providerInterruptOf`）：
//     「这一趟算不算数」和「要不要再拨」若各算一份，迟早会漂成两把尺。
import { providerInterruptOf } from "./eval-validity";

/** 单次重拨的起始等待；`X-RateLimit-Reset` 能算出更准的等待时以它为准（但仍受帽约束）。 */
export const RETRY_BASE_MS = 20_000;
/** 愿意等的最长一段时间：超过就判「不重拨」。默认 5 分钟——再久就不叫重试，叫把跑器挂在那儿。 */
export const RETRY_WAIT_CAP_MS = 300_000;
/** 最多试几趟（含第一趟）。 */
export const RETRY_MAX_ATTEMPTS = 3;

export type RetryVerdict =
  | { retry: true; waitMs: number; why: string }
  | { retry: false; why: string };

/** 从错误文本里取端点给的 reset（epoch ms 或秒）。取不到返回 null——**不许**据此猜。 */
function resetEpochMs(text: string): number | null {
  const m = /X-RateLimit-Reset\\?"?\s*:\s*\\?"?([0-9]{10,13})/u.exec(text);
  if (m === null || m[1] === undefined) return null;
  const raw = Number(m[1]);
  return m[1].length <= 10 ? raw * 1000 : raw;
}

/**
 * 这一趟该不该再拨一次。
 * `fails` 是判卷给出的失败原因列表（与分母那一头同一份输入）；`nowMs` 让判据可单测。
 */
export function retryVerdict(
  fails: readonly string[],
  attempt: number,
  opts: { nowMs: number; maxAttempts?: number; baseMs?: number; waitCapMs?: number },
): RetryVerdict {
  const maxAttempts = opts.maxAttempts ?? RETRY_MAX_ATTEMPTS;
  const baseMs = opts.baseMs ?? RETRY_BASE_MS;
  const waitCapMs = opts.waitCapMs ?? RETRY_WAIT_CAP_MS;
  const interrupt = providerInterruptOf(fails);
  if (interrupt === null) {
    return { retry: false, why: "不是 provider 侧打断 ⇒ 那是被度量的行为，重拨等于给它第二次机会刷分" };
  }
  if (attempt >= maxAttempts) {
    return { retry: false, why: `已拨到第 ${String(attempt)} 趟（帽 ${String(maxAttempts)}）⇒ 停，剩下的记为「跑不成」而不是「没做到」` };
  }
  // reset 从**整份 fails**里找，不从 `providerInterruptOf` 返回的那一条里找：
  // 判卷给的那条是被截断的（`loop-eval.grade` 把 exitError 只留 60 字），
  // 而 `X-RateLimit-Reset` 在 150 字往后 ⇒ 只认那一条的话，帽这一档永远是死代码（10-02 实测 0/36 命中）。
  const reset = resetEpochMs(fails.join(" "));
  if (reset === null) {
    return { retry: true, waitMs: baseMs, why: `端点没给 reset ⇒ 按基础等待 ${String(baseMs)}ms 试第 ${String(attempt + 1)} 趟` };
  }
  const waitMs = reset - opts.nowMs;
  if (waitMs <= 0) {
    return { retry: true, waitMs: baseMs, why: `端点给的 reset 已过期 ⇒ 不等，直接试第 ${String(attempt + 1)} 趟` };
  }
  if (waitMs > waitCapMs) {
    return {
      retry: false,
      why: `端点要等 ${String(Math.round(waitMs / 60000))} 分钟才放行，超出可等待上限 ${String(Math.round(waitCapMs / 60000))} 分钟 ⇒ 不重拨（那是日配额，不是抖动）`,
    };
  }
  return { retry: true, waitMs, why: `按端点给的 reset 等 ${String(waitMs)}ms 后试第 ${String(attempt + 1)} 趟` };
}

/**
 * 执行壳：按判据重拨，等待走注入的 `sleep`（判卷给假时钟，真跑给 setTimeout）。
 * 返回**最后一次**的结果与总趟数——次数是要印出来的读数，不然「重试有效」永远只是说法。
 */
export async function withProviderRetry<T>(
  run: (attempt: number) => Promise<T>,
  decide: (result: T, attempt: number) => RetryVerdict,
  sleep: (ms: number) => Promise<void>,
  opts: { maxAttempts?: number } = {},
): Promise<{ value: T; attempts: number; waitedMs: number; stoppedWhy: string }> {
  const maxAttempts = opts.maxAttempts ?? RETRY_MAX_ATTEMPTS;
  let attempt = 1;
  let value = await run(attempt);
  let waitedMs = 0;
  for (;;) {
    const v = decide(value, attempt);
    if (!v.retry) return { value, attempts: attempt, waitedMs, stoppedWhy: v.why };
    if (attempt >= maxAttempts) return { value, attempts: attempt, waitedMs, stoppedWhy: v.why };
    await sleep(v.waitMs);
    waitedMs += v.waitMs;
    attempt += 1;
    value = await run(attempt);
  }
}
