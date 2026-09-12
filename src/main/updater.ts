// M4b §2.3：自动更新 V1 = 轻量检查（不引 electron-updater，零新依赖，不做自动下载/安装）。
// 可配 manifest URL（settings.updateManifestUrl，缺省空 = 「未配置更新源」显式态）；
// 「检查更新」= fetch manifest {version, url, notes} → 手写三段 semver 比较 → 有新版返回卡载荷
// （renderer 出卡引导打开下载页，shell.openExternal 走 IPC agent:update-open，仅 https 白名单）。
// 网络失败 / 坏 manifest = 显式 error 态，绝不静默。
import { DEFAULT_STALL_MS, stallGuard } from "../net";

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
  const doFetch = opts.fetchImpl ?? fetch;
  // 根因 4：更新源挂起时不再让 IPC promise 永久悬空（UI 永久转圈）。
  const guard = stallGuard(opts.stallTimeoutMs ?? DEFAULT_STALL_MS, "更新源");
  let res: Response;
  try {
    res = await doFetch(url, { headers: { accept: "application/json" }, signal: guard.signal });
  } catch (err) {
    return { state: "error", message: "更新源不可达：" + (err instanceof Error ? err.message : String(err)) };
  } finally {
    guard.dispose();
  }
  if (!res.ok) return { state: "error", message: "更新源响应 HTTP " + String(res.status) };
  let raw: unknown;
  try {
    raw = JSON.parse(await res.text()) as unknown;
  } catch {
    return { state: "error", message: "更新源返回的不是合法 JSON" };
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
