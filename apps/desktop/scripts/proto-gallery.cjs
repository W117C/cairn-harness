// 原型画廊：把 design/prototype.html 的关键场景离屏截图（capturePage，无权限问题）。
// 用法：node scripts/proto-gallery.cjs → /tmp/proto-gallery/*.png
const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = "/tmp/proto-gallery";
mkdirSync(OUT, { recursive: true });

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1440, height: 900, show: false });
  await win.loadFile(join(__dirname, "..", "design", "prototype.html"));
  const shot = async (name, ms = 600) => {
    await new Promise((r) => setTimeout(r, ms));
    writeFileSync(join(OUT, name), (await win.webContents.capturePage()).toPNG());
    console.log("[proto]", name);
  };
  const js = (code) => win.webContents.executeJavaScript(code);

  // 场景切换走顶部 harness 的 scene-btn（文本 = 场景 label）。
  const go = async (label) => {
    await js(`[...document.querySelectorAll(".scene-btn")].find(b=>b.textContent.trim()==="${label}")?.click()`);
    await new Promise((r) => setTimeout(r, 400));
  };

  await shot("00-default.png", 1200);
  await go("运行中"); await shot("01-running.png");
  await go("完成"); await shot("02-done.png");
  await go("审批"); await shot("03-approval.png");
  console.log("[proto] done");
  app.exit(0);
}
main().catch((e) => { console.error(e); app.exit(1); });
