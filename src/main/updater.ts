// M4b §2.3：自动更新 V1 = 轻量检查（不引 electron-updater，零新依赖，不做自动下载/安装）。
// 可配 manifest URL（settings.updateManifestUrl，缺省空 = 「未配置更新源」显式态）；
// 「检查更新」= fetch manifest {version, url, notes} → 手写三段 semver 比较 → 有新版返回卡载荷
// （renderer 出卡引导打开下载页，shell.openExternal 走 IPC agent:update-open，仅 https 白名单）。
// 网络失败 / 坏 manifest = 显式 error 态，绝不静默。
import { DEFAULT_STALL_MS, stallGuard } from "../net";
import type { StallGuard } from "../net";

export interface UpdateManifest {
  version: string;
  url: string;
  notes?: string;
}

export type UpdateCheckResult =
  | { state: "unconfigured" }
  | { state: "error"; message: string }
  | { state: "up-to-date"; currentVersion: string; manifestVersion: string }
  | { state: "available"; currentVersion: string; version: string; url: string; notes?: string };

/** 三段 semver 严格解析（/^\d+\.\d+\.\d+$/，禁前导段缺失/多余/非数字）。 */
export function parseSemver(v: string): [number, number, number] | null {
  if (!/^\d+\.\d+\.\d+$/.test(v)) return null;
  const [a, b, c] = v.split(".").map((x) => Number(x));
  if (a === undefined || b === undefined || c === undefined) return null;
  return [a, b, c];
}

/** 手写三段比较（不引依赖）：-1 = a < b，0 = 相等，1 = a > b；任一非法 = null。 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const x = pa[i]!;
    const y = pb[i]!;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** 核心检查（纯逻辑，fetch 可注入；headless 单测与 commercial-check 零网络依赖）。 */
export async function checkUpdate(opts: {
  manifestUrl: string;
  currentVersion: string;
  fetchImpl?: typeof fetch;
  /** 停滞守卫静默窗口 ms（根因 4）；缺省 60s，<=0 关闭守卫。 */
  stallTimeoutMs?: number;
}): Promise<UpdateCheckResult> {
  const url = opts.manifestUrl.trim();
  if (url === "") return { state: "unconfigured" };
  // D5（审查 P2）：manifest 拉取只放行 https——URL 由 renderer 经 settings-set 写入，
  // 放行 http/file 等于借主进程网络面做 SSRF/明文劫持。
  try {
    const p = new URL(url);
    if (p.protocol !== "https:") return { state: "error", message: "更新源必须为 https（拒绝 " + p.protocol + "）" };
  } catch {
    return { state: "error", message: "更新源 URL 非法" };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  // 根因 4：更新源挂起时不再让 IPC promise 永久悬空（UI 永久转圈）。
  const guard = stallGuard(opts.stallTimeoutMs ?? DEFAULT_STALL_MS, "更新源");
  let res: Response;
  try {
    res = await doFetch(url, { headers: { accept: "application/json" }, signal: guard.signal });
  } catch (err) {
    // 审查 S3（任务 4.5）两处收口：
    // ① dispose：这条 return 在 body 段 try/finally **之外**，过去每次网络失败都留一个活定时器
    //   （到点再去 abort 一个早已返回的 IPC），失败面累积；成功路径由下面 finally 兜。
    // ② 文案分流：守卫触发时 err 是 abort reason，一律印成「更新源不可达：…」会让人去查
    //   DNS/域名，而真因是对端挂起。判据用 signal.aborted（确定性），不猜 err.message 的字面。
    guard.dispose();
    if (guard.signal.aborted) return { state: "error", message: stallMessage(guard) };
    return { state: "error", message: "更新源不可达：" + (err instanceof Error ? err.message : String(err)) };
  }
  // C4（审查 P1-7）：守卫必须罩到 body 读取完成——旧实现 dispose 在 fetch 的 finally 里，
  // 更新源发完响应头再挂起 body 时 `await res.text()` 无 signal，IPC 仍永久悬空。
  try {
    if (!res.ok) return { state: "error", message: "更新源响应 HTTP " + String(res.status) };
    // D5（审查 P2）：响应体上限——流式读取、超 1MB 即中止（Content-Length 缺失时也无界内存面）。
    let raw: unknown;
    try {
      raw = JSON.parse(await readBodyCapped(res, MAX_MANIFEST_BYTES, guard)) as unknown;
    } catch (err) {
      // 审查 S3（任务 4.5）：body 读 stalls 时 reader.read() 抛的是守卫的 abort reason，
      // 过去被同一个 catch 吞成「不是合法 JSON」——把网络问题报成格式问题。格式类错误仍走原话术。
      if (guard.signal.aborted) return { state: "error", message: stallMessage(guard) };
      return {
        state: "error",
        message: "更新源返回的不是合法 JSON（或超过 1MB 上限）：" + (err instanceof Error ? err.message : String(err)),
      };
    }
    if (typeof raw !== "object" || raw === null) return { state: "error", message: "manifest 不是对象" };
    const m = raw as Record<string, unknown>;
    const unknownKeys = Object.keys(m).filter((k) => k !== "version" && k !== "url" && k !== "notes");
    if (unknownKeys.length > 0) return { state: "error", message: "manifest 未知字段：" + unknownKeys.join("、") };
    if (typeof m.version !== "string" || parseSemver(m.version) === null) {
      return { state: "error", message: "manifest.version 缺失或不是三段 semver" };
    }
    if (typeof m.url !== "string" || m.url.trim() === "") {
      return { state: "error", message: "manifest.url 缺失（下载页地址）" };
    }
    const cmp = compareSemver(m.version, opts.currentVersion);
    if (cmp === null) return { state: "error", message: "版本比对失败（当前版本 " + opts.currentVersion + " 非三段 semver）" };
    if (cmp <= 0) return { state: "up-to-date", currentVersion: opts.currentVersion, manifestVersion: m.version };
    return {
      state: "available",
      currentVersion: opts.currentVersion,
      version: m.version,
      url: m.url,
      ...(typeof m.notes === "string" ? { notes: m.notes } : {}),
    };
  } finally {
    guard.dispose();
  }
}

/** manifest 响应体上限（D5，审查 P2）：流式读取，超帽中止（1MB 对版本 manifest 已极宽裕）。
 *  无 body 流（测试替身等）时回退 res.text()——上限由 Content-Length 早帽兜底。 */
const MAX_MANIFEST_BYTES = 1024 * 1024;

/** 守卫文案：优先用 abort reason 自带的可读原因（net.ts 以 Error 作 reason）。 */
function stallMessage(guard: StallGuard): string {
  const reason = guard.signal.reason;
  return reason instanceof Error && reason.message !== ""
    ? reason.message
    : "更新源停滞超时（窗口内无任何数据；对端挂起或网络黑洞）";
}

async function readBodyCapped(res: Response, cap: number, guard?: StallGuard): Promise<string> {
  const declared = Number(res.headers?.get?.("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > cap) throw new Error("body 超上限");
  const reader = res.body?.getReader?.();
  if (!reader) return await res.text();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    // 审查 S3（任务 4.5）：进展即续命——窗口是「停滞」窗口而非「总时长」上限，慢而有进展的
    // 响应体（弱网/大 manifest）过去会被一次性定时器误杀，bump 就是为此存在。
    guard?.bump();
    if (bytes > cap) {
      void reader.cancel().catch(() => {});
      throw new Error("body 超上限");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

/** 下载页白名单：只允许 http(s)（防 file:/自定义协议被 manifest 注入 openExternal）。 */
export function isSafeExternalUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}
