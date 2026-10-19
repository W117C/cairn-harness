// 桌面硬化真机冒烟：在**真实 Electron** 里验证浏览器窗格两条安全面。
//   ① 权限请求默认拒绝（Notification.requestPermission() → "denied"）；
//   ② 302 重定向到未授权 host（169.254.169.254）被 will-redirect 拦下，并推送 pending 供授权卡。
// 跑法：pnpm --filter cairn-desktop hardening-smoke
import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { BrowserHost } from "../src/main/browser-host";

const states: { id: string; url: string; pending?: { url: string } }[] = [];

async function main(): Promise<void> {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body>hardening</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const base = `http://127.0.0.1:${String(port)}`;

  const host = new BrowserHost(() => win, (s) => states.push({ id: s.id, url: s.url, ...(s.pending !== undefined ? { pending: s.pending } : {}) }));
  const opened = host.open("audit", base + "/");
  if (!opened.ok) throw new Error(`open 失败：${opened.error}`);
  const wc = host.webContentsForAudit("audit");
  if (wc === null) throw new Error("拿不到 webContents");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("首屏加载超时")), 10_000);
    wc.once("did-stop-loading", () => { clearTimeout(timer); resolve(); });
  });

  const perm = (await wc.executeJavaScript("Notification.requestPermission()")) as string;
  if (perm !== "denied") throw new Error(`权限默认不是拒绝：${perm}`);

  const nav = host.open("audit", base + "/redirect");
  if (!nav.ok) throw new Error(`redirect 导航启动失败：${nav.error}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    if (states.some((s) => s.pending?.url.includes("169.254.169.254"))) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const blocked = states.find((s) => s.pending?.url.includes("169.254.169.254"));
  if (blocked === undefined) throw new Error("302 到未授权 host 没有被拦下（没有 pending 推送）");
  if (wc.getURL().includes("169.254.169.254")) throw new Error("页内重定向真的发生了（拦截失效）");

  // popout 归属：BrowserHost 把视图加到**调用方给的那个窗口**（index.ts 传 focused-first）。
  // 这里用第二个窗口做替身，证实视图不会恒挂主窗。
  const popup = new BrowserWindow({ show: false, width: 400, height: 300 });
  const host2 = new BrowserHost(() => popup, () => undefined);
  const mainBefore = win.contentView.children.length;
  if (!host2.open("pop", base + "/").ok) throw new Error("popout 视图打开失败");
  if (popup.contentView.children.length === 0) throw new Error("popout 视图没有挂到目标窗口");
  if (win.contentView.children.length !== mainBefore) throw new Error("popout 视图被挂到了主窗");
  host2.close("pop");
  popup.destroy();

  console.log(`[hardening-smoke] permission=${perm} redirect=pending(${blocked.pending?.url ?? ""}) url=${wc.getURL()}`);
  console.log("[hardening-smoke] PASS");
  host.close("audit");
  server.close();
  win.destroy();
  app.exit(0);
}

main().catch((err: unknown) => {
  console.error("[hardening-smoke] FAIL:", err instanceof Error ? err.message : String(err));
  app.exit(1);
});
