// 量 composer 周边的几何（临时诊断脚本）：各条带与输入卡是否同宽同缘。
const { app, BrowserWindow } = require("electron");
const { join } = require("node:path");

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: join(__dirname, "ui-gallery-preload.cjs") } });
  await win.loadFile(join(__dirname, "..", "dist", "index.html"));
  await new Promise((r) => setTimeout(r, 1200));
  await win.webContents.executeJavaScript(`document.querySelector(".session")?.click()`);
  await new Promise((r) => setTimeout(r, 900));
  const rects = await win.webContents.executeJavaScript(`(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    };
    return {
      main: pick(".main"),
      zoneComposer: pick(".zone-composer"),
      composerCard: pick(".composer-card"),
      statusStrip: pick(".status-strip"),
      ctxMeter: pick(".status-strip .ctx-meter"),
      changesCard: pick(".changes-card"),
      ctxRow: pick(".ctx-row"),
      reading: pick(".reading"),
      gate: pick(".zone-gate"),
    };
  })()`);
  console.log(JSON.stringify(rects, null, 1));
  app.exit(0);
}
main().catch((e) => { console.error(e); app.exit(1); });
