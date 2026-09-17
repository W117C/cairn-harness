// 冒烟：Electron 加载 out/renderer + 注入最小 window.agent，验证真实桥接不炸、会话列表/消息流渲染
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'smoke-preload.cjs'),
    },
  });
  const errors = [];
  win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 3 || /error/i.test(msg)) errors.push(msg); });
  await win.loadFile(path.join(__dirname, '../out/renderer/index.html'));
  await new Promise(r => setTimeout(r, 1800));
  const state = await win.webContents.executeJavaScript(`
    (function(){
      var out = {};
      out.agentPresent = !!window.agent;
      out.sessions = (document.querySelectorAll('.session').length);
      out.firstTitle = (function(){ var t = document.querySelector('.session .s-txt'); return t ? t.textContent : null; })();
      out.chatTitle = (document.querySelector('#chatTitle')||{}).textContent || null;
      out.msgs = document.querySelectorAll('.stream-inner .msg').length;
      out.userMsgs = (function(){ return Array.from(document.querySelectorAll('.msg.user .bubble')).map(function(b){ return b.textContent.slice(0, 30); }); })();
      out.aiTextBlocks = document.querySelectorAll('.ai-text').length;
      out.cards = document.querySelectorAll('.card').length;
      out.asks = document.querySelectorAll('.card.ask').length;
      out.promptVal = (document.querySelector('#promptInput')||{}).value;
      return JSON.stringify(out);
    })()
  `);
  console.log('STATE', state);
  console.log('CONSOLE_ERRORS', errors.length ? errors.slice(0, 5).join(' || ') : 'NONE');
  app.quit();
});