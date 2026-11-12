// 聊天正文里的 http(s) 链接 → 侧边栏浏览器窗格（2026-11-05 业主）。
// 外链不再跳出系统浏览器，而是进 browser 窗格：独立 profile（persist:cairn-browser）、
// 无 preload、站点授权闸照走——不破 2026-10-17 的应用窗导航硬化（外部页面只进无 preload 容器）。
//
// 传输用模块级处理器注册，不用 window 事件：PaneDock 是条件挂载（paneTabs 为空即卸载），
// 监听放它身上会在「窗格全关」时丢链接；注册收口在常驻的 WorkbenchView。
// 没有注册方的环境（独立弹出窗）回落系统浏览器——与旧行为一致，不产生死点击。
// seq 单调递增：BrowserPane 按 seq 前进导航，同 seq 重放不动作。

let handler: ((url: string) => void) | null = null;
/** 无宿主回落失败的发声口：独立弹出窗没有 ToastHost（main.tsx 只给主窗口挂），
 *  由 PopoutApp 注册自己的错误条；未注册时退回 console.error，至少不静默。 */
let failureHandler: ((failure: { url: string; error: string }) => void) | null = null;

export function registerBrowserLinkFailureHandler(
  fn: ((failure: { url: string; error: string }) => void) | null,
): void {
  failureHandler = fn;
}

function reportOpenFailure(url: string, error: string): void {
  if (failureHandler !== null) {
    failureHandler({ url, error });
    return;
  }
  console.error("[browser-link] 打开链接失败:", error);
}

/** http(s) 判定：解析失败或非 http(s)（mailto: 等）不拦，走既有默认路径（target=_blank → 主进程 openExternalSafe）。 */
export function isWebLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** markdown 面调用：http(s) 链接点击转发给当前注册的处理器；无注册方则回落系统浏览器。 */
export function requestBrowserOpen(url: string): void {
  if (handler !== null) {
    handler(url);
    return;
  }
  void window.agent.openExternal(url).then(
    (r) => { if (!r.ok) reportOpenFailure(url, r.error ?? "系统浏览器未能打开链接"); },
    (err: unknown) => { reportOpenFailure(url, err instanceof Error ? err.message : String(err)); },
  );
}

/** 常驻宿主（WorkbenchView）在挂载时注册；卸载（或 StrictMode 重挂）时传 null 注销。 */
export function registerBrowserLinkHandler(fn: ((url: string) => void) | null): void {
  handler = fn;
}
