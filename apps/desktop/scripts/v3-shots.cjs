// 原型截图（设计自查用，非产品组件）：离屏渲染 + capturePage，不需要录屏权限、不弹系统窗。
// 场景清单直接读页面顶部的 .scene-btn，所以换原型文件不用改脚本。
// 用法：./apps/desktop/node_modules/.bin/electron apps/desktop/scripts/v3-shots.cjs [原型文件名]
const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync, readdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");

const FILE = process.argv.find((a) => a.endsWith(".html")) || "v3-cockpit.html";
const OUT = "/tmp/v3-shots/" + FILE.replace(/\.html$/, "");
mkdirSync(OUT, { recursive: true });
// 场景序号会变，旧图留着会让人读到上一版：先清掉本目录的 png
for (const f of readdirSync(OUT)) if (f.endsWith(".png")) rmSync(join(OUT, f), { force: true });

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1480, height: 980, show: false });
  await win.loadFile(join(__dirname, "..", "design", FILE));
  await new Promise((r) => setTimeout(r, 700));
  const scenes = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.scene-btn')].map(b=>[b.dataset.scene, b.textContent.trim()])`
  );
  let n = 0;
  for (const [scene, label] of scenes) {
    const wide = scene === "narrow" ? 680 : 1440;
    await win.setContentSize(wide + 40, 980);
    await win.webContents.executeJavaScript(
      `document.querySelector('.scene-btn[data-scene="${scene}"]')?.click(); true`
    );
    await new Promise((r) => setTimeout(r, 420));
    const img = await win.webContents.capturePage();
    writeFileSync(join(OUT, `${String(++n).padStart(2, "0")}-${scene}.png`), img.toPNG());
    console.log("[shot]", scene, label, wide);
  }
  app.exit(0);
}
main().catch((e) => { console.error("[shot] FAIL", e); app.exit(1); });
