// browser 窗格的主进程宿主：Electron WebContentsView（蓝本 §3.5）。
// 设计要点：
//   · **独立干净 profile**（persist:cairn-browser——不带个人登录与历史，与主窗口隔离）；
//   · 视图叠在窗口 contentView 上（原生层），位置由渲染层报告容器矩形（setBounds）；
//   · 零 Node 集成（sandbox/contextIsolation 默认持有），只导航；
//   · 导航状态（URL/可后退/可前进/加载中）推送给渲染层（工具条回显）。
// 站点授权决策不在本层（渲染层在导航前问；本层只管执行）。
import { WebContentsView, type BrowserWindow } from "electron";

export interface BrowserState {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  /** v7 元素选择回程：页内 ⌘⇧S（页面焦点不在渲染层，按键由 before-input-event 捕获）。
   *  与 browserPickElement 返回同形；只在发生选择时出现，普通状态推送不带。 */
  pick?: { ok: boolean; selector?: string; snippet?: string; url?: string; error?: string };
  /** 页内跳转/重定向被拦下、需要用户授权：渲染层用现有站点授权卡问一次。 */
  pending?: { url: string };
}

interface Entry { view: WebContentsView }

/** 一次导航的处置（纯函数面；判卷直接钉，不靠源码断言）。 */
export type NavigationDecision =
  /** 放行。 */
  | "allow"
  /** 主框架跳未授权站点：拦下，并给渲染层一张待批卡（用户可显式授权这个 host）。 */
  | "block-main"
  /** 子框架（iframe）跳未授权站点：拦下，但**不**动本窗格的标题与待批卡
   *  （页面的第三方 iframe 不是用户发起的导航；一个带十个追踪像素的页面不该弹十张卡）。 */
  | "block-frame";

/** 目标 host 是否在授权面内（纯函数面）。
 *  只认 http/https；localhost 与回环地址视作本地面（与渲染层 sitePermissionFor 的 "local" 同口径）。 */
export function hostAllowed(raw: string, allowedHosts: ReadonlySet<string>): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || allowedHosts.has(host);
  } catch {
    return false;
  }
}

/** 一次导航的处置判据（纯函数面）。
 *
 *  **为什么主框架与子框架要分开**：`will-navigate` / `will-redirect` **只对主框架触发**。
 *  旧实现只挂这两个 ⇒ 页面里一个 `<iframe src="https://intranet.corp/">` 就能把未授权站点
 *  拉进窗格跑 JS/WebSocket，而 UI 上那份"已授权站点"清单（还能逐站移除）让人以为它限定了
 *  这个窗格能到哪。Electron 44 有 `will-frame-navigate`（主框架与子框架都触发，带 isMainFrame）——
 *  接上这一支才是完整的闸。
 *
 *  主框架那一支仍走 `will-navigate`（文案与待批语义逐字不变）；这里对主框架也返回 block-main，
 *  是为了让判据本身自洽、可单测——接线时主框架那一支由 will-navigate 负责，不重复弹卡。 */
export function decideNavigation(url: string, isMainFrame: boolean, allowedHosts: ReadonlySet<string>): NavigationDecision {
  if (hostAllowed(url, allowedHosts)) return "allow";
  return isMainFrame ? "block-main" : "block-frame";
}

export class BrowserHost {
  /** 已授权站点（host）。只由 open() 的显式导航写入——渲染层在地址栏提交前已问过用户。 */
  private readonly allowedHosts = new Set<string>();
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly push: (state: BrowserState) => void,
  ) {}

  private stateOf(id: string): BrowserState | null {
    const e = this.entries.get(id);
    if (e === undefined) return null;
    const wc = e.view.webContents;
    return {
      id,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    };
  }

  private emit(id: string): void {
    const s = this.stateOf(id);
    if (s !== null) this.push(s);
  }

  /** 元素选择结果封进一次 browserState 推送（普通状态与 pick 并存；视图已关则丢弃）。 */
  private pushPick(id: string, r: { ok: boolean; selector?: string; snippet?: string; url?: string; error?: string }): void {
    const base = this.stateOf(id);
    if (base === null) return;
    const pick = r.ok
      ? { ok: true, ...(r.selector !== undefined ? { selector: r.selector } : {}), ...(r.snippet !== undefined ? { snippet: r.snippet } : {}), ...(r.url !== undefined ? { url: r.url } : {}) }
      : { ok: false, ...(r.error !== undefined ? { error: r.error } : {}) };
    this.push({ ...base, pick });
  }

  /** 冒烟/判卷用：底层 webContents（只用于观察权限与导航，不供业务路径调用）。 */
  webContentsForAudit(id: string): import("electron").WebContents | null {
    return this.entries.get(id)?.view.webContents ?? null;
  }

  /** 渲染层授权清单全量同步（移除站点/忘记全部后，主进程的页内跳转闸必须立刻跟上）。 */
  setAllowedHosts(hosts: readonly string[]): void {
    this.allowedHosts.clear();
    for (const h of hosts) {
      const host = h.trim().toLowerCase();
      if (host !== "") this.allowedHosts.add(host);
    }
  }

  /** 目标 URL 是否允许在本窗格导航：只认 http/https，且 host 已由显式地址栏导航授权
   *  （localhost 视作本地面，与渲染层 sitePermissionFor 的 "local" 同口径）。 */
  private targetAllowed(raw: string): boolean {
    return hostAllowed(raw, this.allowedHosts);
  }

  /** 创建（或复用后导航）某 id 的浏览器视图。 */
  open(id: string, url: string): { ok: true } | { ok: false; error: string } {
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { ok: false, error: `只允许 http/https，已拒绝：${u.protocol}` };
      }
      host = u.hostname.toLowerCase();
    } catch {
      return { ok: false, error: `不是合法 URL：${url}` };
    }
    // 地址栏提交前渲染层已经问过用户（sitePermissionFor）⇒ 这里把 host 记为授权。
    this.allowedHosts.add(host);
    const win = this.getWindow();
    if (win === null) return { ok: false, error: "主窗口不在（浏览器视图无处安放）" };
    let e = this.entries.get(id);
    if (e === undefined) {
      const view = new WebContentsView({
        webPreferences: {
          // 独立干净 profile：不共享主窗口会话（无个人登录与历史）。
          partition: "persist:cairn-browser",
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      win.contentView.addChildView(view);
      e = { view };
      this.entries.set(id, e);
      const wc = view.webContents;
      // 远端页面权限默认**全拒**：Electron 缺省会对 getUserMedia/geolocation/notifications/
      // clipboard-read 等请求自动批准，页内一行 JS 就能开摄像头/麦克风或读剪贴板。
      wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      wc.session.setPermissionCheckHandler(() => false);
      // 页内跳转 / 302 重定向 / window.open 都不经过地址栏：主进程按已授权 host 逐跳复查，
      // 未授权一律留在当前页（旧实现只有渲染层对「地址栏输入」问一次，跨域跳转直接放行）。
      wc.on("will-navigate", (ev, target) => {
        if (this.targetAllowed(target)) return;
        ev.preventDefault();
        const s = this.stateOf(id);
        if (s !== null) this.push({ ...s, title: `已拦截跳转：${target}（未授权站点；需要时在地址栏重新输入）`, pending: { url: target } });
      });
      wc.on("will-redirect", (ev, target) => {
        if (this.targetAllowed(target)) return;
        ev.preventDefault();
        const s = this.stateOf(id);
        if (s !== null) this.push({ ...s, title: `已拦截重定向：${target}（未授权站点）`, pending: { url: target } });
      });
      // 子框架（iframe）导航（2026-10-19 独立评审追出）：`will-navigate` / `will-redirect`
      // **只对主框架触发** ⇒ 页面里一个 `<iframe src="https://intranet.corp/">` 就能把未授权站点
      // 拉进窗格跑 JS/WebSocket，而 UI 上那份"已授权站点"清单（还能逐站移除）让人以为它限定了
      // 这个窗格能到哪。Electron 44 的 `will-frame-navigate` 主框架与子框架都触发（带 isMainFrame）
      // —— 实测真 Electron 44：子框架跳转时 will-navigate 根本不触发，will-frame-navigate 触发。
      // 主框架那一支仍由 will-navigate 负责（文案与待批语义逐字不变），这里只管子框架。
      wc.on("will-frame-navigate", (details) => {
        if (details.isMainFrame) return; // 主框架走 will-navigate
        if (decideNavigation(details.url, false, this.allowedHosts) === "allow") return;
        details.preventDefault();
        // 不推标题、不给待批卡：第三方 iframe 不是用户发起的导航，一个带十个追踪像素的页面
        // 不该弹十张卡、也不该把本窗格的标题改成"已拦截"。拦下的事实进主进程日志。
        console.warn("[browser] 已拦截子框架跳转（未授权站点）:", details.url);
      });
      // window.open / target=_blank（2026-10-17）：单窗格模型没有新标签页，默认行为会新开一个
      // 不受主窗口硬化约束的 Electron 窗口。这里把弹窗降级为「本窗格内导航」（仅 http/https），
      // 其余协议一律拒绝——既保留链接可用，又不把浏览面变成任意窗口工厂。
      wc.setWindowOpenHandler(({ url }) => {
        try {
          const u = new URL(url);
          if ((u.protocol === "http:" || u.protocol === "https:") && this.targetAllowed(u.href)) {
            void wc.loadURL(u.href).catch(() => undefined);
          }
        } catch { /* 非法 URL：拒绝 */ }
        return { action: "deny" };
      });
      wc.on("did-navigate", () => { this.emit(id); });
      wc.on("did-navigate-in-page", () => { this.emit(id); });
      wc.on("did-start-loading", () => { this.emit(id); });
      wc.on("did-stop-loading", () => { this.emit(id); });
      wc.on("page-title-updated", () => { this.emit(id); });
      wc.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // 只认主框架的失败（2026-10-19 独立评审追出）：Electron 的 did-fail-load 对**每个**帧都触发，
        // 而旧实现忽略 isMainFrame ⇒ 页面里一个加载失败的第三方 iframe（被拦的广告帧、
        // 拉不到的追踪像素）会把**那个 iframe 的 URL** 推成本窗格的 URL，标题也变成那句错误文案。
        // 实测真 Electron 44：主框架 did-navigate 之后，子框架失败事件才到 ⇒ 覆盖掉正确的 URL，
        // 而渲染层 `if (key === activeKeyRef.current && s.url !== "") setUrlDraft(s.url)`
        // 会照单全收 ⇒ 地址栏变成用户从没打开过的 URL（可以据此点进任意外站）。
        if (!isMainFrame) return;
        this.push({ id, url: validatedURL, title: `加载失败：${errorDescription}（${String(errorCode)}）`, canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), loading: false });
      });
      // v7 元素选择：页面持有焦点时渲染层收不到 ⌘⇧S（原生视图独立 webContents）——
      // 在本层捕获再走同一 pickElement，结果经 browserState.pick 推回渲染层。
      wc.on("before-input-event", (ev, input) => {
        if (input.type !== "keyDown" || !input.meta || !input.shift || input.alt) return;
        if (input.key.toLowerCase() !== "s") return;
        ev.preventDefault();
        void this.pickElement(id).then((r) => { this.pushPick(id, r); });
      });
    }
    void e.view.webContents.loadURL(url).catch((err: unknown) => {
      this.push({ id, url, title: `加载失败：${err instanceof Error ? err.message : String(err)}`, canGoBack: false, canGoForward: false, loading: false });
    });
    return { ok: true };
  }

  /** 容器矩形（渲染层报告的窗口内像素坐标；宽高 ≤0 视为隐藏）。 */
  setBounds(id: string, rect: { x: number; y: number; width: number; height: number }): void {
    const e = this.entries.get(id);
    if (e === undefined) return;
    if (rect.width <= 0 || rect.height <= 0) {
      e.view.setVisible(false);
      return;
    }
    e.view.setVisible(true);
    e.view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
  }

  navigate(id: string, action: "back" | "forward" | "reload"): void {
    const e = this.entries.get(id);
    if (e === undefined) return;
    const wc = e.view.webContents;
    if (action === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === "reload") wc.reload();
    this.emit(id);
  }

  close(id: string): void {
    const e = this.entries.get(id);
    if (e === undefined) return;
    this.entries.delete(id);
    try {
      this.getWindow()?.contentView.removeChildView(e.view);
      e.view.webContents.close();
    } catch {
      // 窗口已在关闭途中的竞态：吞掉（资源随窗口走）。
    }
  }

  /** v7 清除浏览数据（§2.4 ⋮ 菜单）：清独立干净 profile（persist:cairn-browser——所有 browser
   *  视图共此 partition）的存储与缓存；keepCookies=true 时保留 cookies（对齐「Keep cookies」的
   *  语义：清站点数据但保持登录态）。 */
  clearData(id: string, keepCookies: boolean): Promise<{ ok: boolean; error?: string }> {
    const e = this.entries.get(id);
    if (e === undefined) return Promise.resolve({ ok: false, error: "本标签页还没有视图（先打开一个网页）" });
    const ses = e.view.webContents.session;
    // appcache/websql 已从 Electron 的 storages 枚举移除（本版类型面实证）：不列不存在的存储。
    const storages = ["filesystem", "indexdb", "localstorage", "shadercache", "serviceworkers", "cachestorage"] as const;
    return ses
      .clearStorageData({ storages: keepCookies ? [...storages] : [...storages, "cookies"] })
      .then(() => ses.clearCache())
      .then(() => ({ ok: true }))
      .catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  }

  /** v7 元素选择（§3.6 ⌘⇧S）：页面内注入取色脚本——移动高亮、点击返回选择器与片段、Esc 取消。
   *  珊瑚高亮 = 标注色（annotation，§5.1 蓝只归链接信息强调；page 之上需要与任意页面底色区分的
   *  独立色相，devtools 同式惯例）。脚本随 promise 回收（click/Esc 任一出口必清 DOM 与监听）。 */
  async pickElement(id: string): Promise<{ ok: boolean; selector?: string; snippet?: string; url?: string; error?: string }> {
    const e = this.entries.get(id);
    if (e === undefined) return { ok: false, error: "本标签页还没有视图（先打开一个网页）" };
    try {
      const res = (await e.view.webContents.executeJavaScript(PICK_ELEMENT_SCRIPT, false)) as
        | { ok: boolean; selector?: string; snippet?: string; url?: string; error?: string };
      return res;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }
}

/** 元素选择脚本（在页面主世界执行；返回 promise——click/Esc 任一出口必清 overlay 与监听）。
 *  选择器：id 优先 `#id`；否则 tag.class(:nth-of-type) 链至多 6 层（够唯一定位，不过度长）。
 *  自包含、零依赖（页面侧无任何框架前提）。 */
const PICK_ELEMENT_SCRIPT = `(() => new Promise((resolve) => {
  if (window.__cairnPickActive === true) { resolve({ ok: false, error: "选择器已在进行中" }); return; }
  window.__cairnPickActive = true;
  const overlay = document.createElement("div");
  const s = overlay.style;
  s.position = "fixed"; s.zIndex = "2147483647"; s.pointerEvents = "none";
  s.border = "2px solid #d97757"; s.background = "rgba(217,119,87,0.16)"; s.borderRadius = "2px";
  s.left = "0px"; s.top = "0px"; s.width = "0px"; s.height = "0px";
  const tip = document.createElement("div");
  const ts = tip.style;
  ts.position = "fixed"; ts.zIndex = "2147483647"; ts.pointerEvents = "none";
  ts.background = "rgba(20,20,19,0.9)"; ts.color = "#faf9f5";
  ts.font = "12px/1.4 -apple-system, system-ui, sans-serif";
  ts.padding = "2px 8px"; ts.borderRadius = "6px"; ts.maxWidth = "70vw";
  ts.overflow = "hidden"; ts.textOverflow = "ellipsis"; ts.whiteSpace = "nowrap";
  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(tip);
  let current = null;
  const selectorOf = (el) => {
    try {
      if (el.id) return "#" + CSS.escape(el.id);
      const parts = [];
      let node = el;
      for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth++) {
        let part = node.tagName.toLowerCase();
        if (node.classList && node.classList.length > 0) {
          part += "." + node.classList[0].replace(/[^a-zA-Z0-9_-]/g, "-");
        }
        const parent = node.parentElement;
        if (parent) {
          const sibs = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
          if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(" > ");
    } catch (e) { return el.tagName ? el.tagName.toLowerCase() : "unknown"; }
  };
  const highlight = (el) => {
    const r = el.getBoundingClientRect();
    s.left = r.left + "px"; s.top = r.top + "px"; s.width = r.width + "px"; s.height = r.height + "px";
    ts.textContent = selectorOf(el);
    ts.style.left = Math.max(4, r.left) + "px";
    ts.style.top = (r.top > 28 ? r.top - 24 : r.bottom + 6) + "px";
  };
  const onMove = (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || el === overlay || el === tip || el === current) return;
    current = el;
    highlight(el);
  };
  const cleanup = () => {
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKey, true);
    overlay.remove(); tip.remove();
    delete window.__cairnPickActive;
  };
  const onClick = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const el = current || ev.target;
    const payload = {
      ok: true,
      selector: selectorOf(el),
      snippet: String(el.outerHTML || "").slice(0, 280),
      url: location.href,
    };
    cleanup();
    resolve(payload);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault(); ev.stopPropagation();
      cleanup();
      resolve({ ok: false, error: "已取消（Esc）" });
    }
  };
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
}))()`;
