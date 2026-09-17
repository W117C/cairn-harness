// 响应式探针：一次跑完「四档视口 × 双主题」，同时产出
//   ① PNG 截图（视觉回归对照）
//   ② DOM 实测数字（可判定断言，比肉眼看图更可证伪）
//
// 用法:
//   node_modules/.bin/electron --no-sandbox --disable-gpu proto/responsive-probe.cjs \
//     <fileUrl> <outDir> '<jobsJson>' [delayMs]
//
// jobsJson 例: [{"name":"w1024-light","w":1024,"h":700,"theme":"light"}, ...]
//
// 输出:
//   <outDir>/<name>.png         截图
//   <outDir>/metrics.json       逐视口实测数字
//
// 设计纪律：断言口径写死在这里，避免「先看图再想判据」的事后合理化。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const url = process.argv[2];
const outDir = process.argv[3];
const jobs = JSON.parse(process.argv[4]);
const delay = parseInt(process.argv[5] || '1400', 10);

// 在渲染进程里跑的测量脚本：只读 DOM，不改任何状态
const MEASURE = `
(() => {
  const px = (el) => (el ? Math.round(el.getBoundingClientRect().width) : -1);
  const vis = (el) => {
    if (!el) return 'absent';
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return 'display:none';
    if (cs.visibility === 'hidden') return 'hidden';
    if (parseFloat(cs.opacity) === 0) return 'opacity:0';
    return 'visible';
  };
  const streamInner = document.querySelector('.stream-inner');
  const composer = document.querySelector('.composer') || document.querySelector('#composer');
  const sidebar = document.querySelector('.sidebar');
  const drawer = document.querySelector('.drawer');
  const gutter = document.querySelector('.gutter');
  const sTxt = document.querySelector('.session .s-txt');
  const sessions = document.querySelectorAll('.session');
  // 会话标题「可见且有可读宽度」的条数——图标栏档若为 0 即为 R-1 型缺陷
  let readableTitles = 0;
  document.querySelectorAll('.session .s-txt').forEach((el) => {
    if (vis(el) === 'visible' && px(el) >= 24) readableTitles += 1;
  });
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    sidebarW: px(sidebar),
    sidebarPos: sidebar ? getComputedStyle(sidebar).position : 'absent',
    drawerW: px(drawer),
    drawerPos: drawer ? getComputedStyle(drawer).position : 'absent',
    gutterDisplay: gutter ? getComputedStyle(gutter).display : 'absent',
    streamInnerW: px(streamInner),
    composerW: px(composer),
    composerVis: vis(composer),
    contentMax: getComputedStyle(document.querySelector('.shell') || document.documentElement)
      .getPropertyValue('--content-max').trim(),
    sessionCount: sessions.length,
    firstTitleVis: vis(sTxt),
    firstTitleW: px(sTxt),
    readableTitles,
    ariaLiveCount: document.querySelectorAll('[aria-live]').length,
    docTheme: document.documentElement.dataset.theme || '(none)',
    bodyScrollW: document.body.scrollWidth,
  };
})()
`;

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const metrics = [];
  for (const j of jobs) {
    const win = new BrowserWindow({
      width: j.w, height: j.h, show: false,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    try {
      await win.loadURL(url);
      await win.webContents.executeJavaScript(`
        (() => {
          document.documentElement.dataset.theme = ${JSON.stringify(j.theme)};
          const s = document.createElement('style');
          s.textContent = '*{transition:none!important;animation:none!important}';
          document.head.appendChild(s);
          return true;
        })();
      `);
      await new Promise((r) => setTimeout(r, delay));
      const m = await win.webContents.executeJavaScript(MEASURE);
      m.job = j.name;
      m.theme = j.theme;
      metrics.push(m);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, j.name + '.png'), img.toPNG());
      console.log('OK  ' + j.name + '  ' + JSON.stringify(m));
    } catch (e) {
      console.log('ERR ' + j.name + '  ' + (e && e.message));
      metrics.push({ job: j.name, error: String((e && e.message) || e) });
    } finally {
      win.destroy();
    }
  }
  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log('--- metrics.json written: ' + path.join(outDir, 'metrics.json'));
  app.quit();
});
