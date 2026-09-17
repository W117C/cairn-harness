// 截图辅助脚本：以指定视口加载原型并输出 PNG
// 用法: node shot.js <url> <outfile> [w] [h] [theme] [delayMs]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const url = process.argv[2];
const out = process.argv[3];
const w = parseInt(process.argv[4] || '1440', 10);
const h = parseInt(process.argv[5] || '900', 10);
const theme = process.argv[6] || 'light';
const delay = parseInt(process.argv[7] || '2500', 10);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: w, height: h, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  await win.loadURL(url);
  // 注入主题 + 关闭动画
  await win.webContents.executeJavaScript(`
    (() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      const s = document.createElement('style');
      s.id = 'shot-freeze';
      s.textContent = '*{transition:none!important;animation:none!important}';
      document.head.appendChild(s);
      return true;
    })();
  `);
  await new Promise(r => setTimeout(r, delay));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('saved', out, img.getSize());
  app.quit();
});
