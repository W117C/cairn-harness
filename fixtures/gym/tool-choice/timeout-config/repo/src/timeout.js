// 超时配置读写（故意有 bug：timeout 单位按秒存，读的时候按毫秒用）。
export const DEFAULTS = { timeoutMs: 30_000, retries: 2 };

/** 从一段扁平配置里读出有效超时；缺 timeout 时回落缺省 30000（毫秒）。 */
export function resolveTimeout(flat) {
  const raw = flat.timeout;
  if (raw === undefined || raw === null || raw === "") return DEFAULTS.timeoutMs;
  // BUG：配置里写的是「秒」，这里当毫秒直接用了 ⇒ 一切配置都被读成超短。
  return Number(raw);
}

/** 把有效超时写回扁平配置（同样按毫秒存）。 */
export function writeTimeout(flat, timeoutMs) {
  return { ...flat, timeout: String(timeoutMs) };
}

/** 连通性探测：按 resolveTimeout 给出的预算等这么久。 */
export async function ping(url, fetchImpl = fetch) {
  const budget = resolveTimeout({ timeout: url.timeout });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    const res = await fetchImpl(url.href, { signal: ctrl.signal });
    return { ok: res.ok, status: res.status, budgetMs: budget };
  } catch (err) {
    return { ok: false, status: 0, budgetMs: budget, error: String(err && err.name) };
  } finally {
    clearTimeout(timer);
  }
}