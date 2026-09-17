// 批量状态截图
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const url = process.argv[2];
const theme = process.argv[3] || 'light';

async function shot(win, out) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('saved', out);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  await win.loadURL(url);
  await win.webContents.executeJavaScript(`
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    const s = document.createElement('style');
    s.id = 'shot-freeze';
    s.textContent = '*{transition:none!important;animation:none!important}';
    document.head.appendChild(s);
    true;
  `);
  await new Promise(r => setTimeout(r, 1500));

  // 1. 默认
  await shot(win, `/tmp/proto-${theme}-1-default.png`);

  // 2. 展开执行计划卡片
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="plan-card"] [data-card-toggle]')?.click(); true;`);
  await new Promise(r => setTimeout(r, 300));
  await shot(win, `/tmp/proto-${theme}-2-plan-open.png`);

  // 3. 展开 diff 卡片
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="diff-card"] [data-card-toggle]')?.click(); true;`);
  await new Promise(r => setTimeout(r, 300));
  await shot(win, `/tmp/proto-${theme}-3-diff-open.png`);

  // 4. 展开终端卡片
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="terminal-card"] [data-card-toggle]')?.click(); true;`);
  await new Promise(r => setTimeout(r, 300));
  await shot(win, `/tmp/proto-${theme}-4-term-open.png`);

  // 5. 打开模型选择面板
  await win.webContents.executeJavaScript(`document.querySelector('#modelSelect')?.click(); true;`);
  await new Promise(r => setTimeout(r, 400));
  await shot(win, `/tmp/proto-${theme}-5-model-pop.png`);

  // 6. 模型列表视图
  await win.webContents.executeJavaScript(`document.querySelector('#mpCur')?.click(); true;`);
  await new Promise(r => setTimeout(r, 400));
  await shot(win, `/tmp/proto-${theme}-6-model-list.png`);

  // 7. 打开设置
  await win.webContents.executeJavaScript(`document.querySelector('#modelSelect')?.click(); document.querySelector('#settingsOpen')?.click(); true;`);
  await new Promise(r => setTimeout(r, 400));
  await shot(win, `/tmp/proto-${theme}-7-settings.png`);

  // 8. 外观设置页
  await win.webContents.executeJavaScript(`document.querySelector('[data-sec="appearance"]')?.click(); true;`);
  await new Promise(r => setTimeout(r, 300));
  await shot(win, `/tmp/proto-${theme}-8-settings-appearance.png`);

  // 9. 打开工作区文件标签
  await win.webContents.executeJavaScript(`document.querySelector('#settingsClose')?.click(); document.querySelector('#qcFiles')?.click(); true;`);
  await new Promise(r => setTimeout(r, 400));
  await shot(win, `/tmp/proto-${theme}-9-files-tab.png`);

  app.quit();
});
