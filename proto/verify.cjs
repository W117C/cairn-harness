const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const url = process.argv[2];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 860, height: 700, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  await win.loadURL(url);
  await new Promise(r => setTimeout(r, 1500));
  await win.webContents.executeJavaScript(`
    (function(){
      // 展开抽屉（窄屏响应式）后再开菜单
      document.querySelector('#sidebar').classList.add('open');
      document.querySelectorAll('.sb-trigger')[6].click();
      var s = document.createElement('style'); s.textContent='*{transition:none!important;animation:none!important}';
      document.head.appendChild(s);
    })()
  `);
  await new Promise(r => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  fs.writeFileSync('/tmp/menu-narrow-open.png', img.toPNG());
  console.log('saved');
  app.quit();
});