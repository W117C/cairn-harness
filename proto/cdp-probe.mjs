// 响应式探针（CDP 版）：一次跑完「多档视口 × 双主题」，同时产出
//   ① PNG 截图（视觉回归对照）
//   ② DOM 实测数字 + 页面运行时错误（可判定断言，比肉眼看图更可证伪）
//
// 为什么不用 Electron：本宿主会在 Electron 起真实 renderer 时把整个进程组 SIGTERM
// （实测 exit=137，stderr 全空；最小 data: URL 用例却能过），故改走 Chrome + CDP。
// Node 22 自带全局 WebSocket + fetch，零第三方依赖。
//
// 为什么内置 HTTP 服务而不是 file://：Chrome 按 CORS 拦截 file:// 下的
// <script type="module">，app.js 根本不会执行，测出来的 DOM 是「只有静态标记」的假象
// （实测 sessionCount=0）。起个本地静态服务即消除该假象。
//
// 用法:
//   node proto/cdp-probe.mjs <htmlPath> <outDir> '<jobsJson>' [delayMs]
// 例:
//   node proto/cdp-probe.mjs out/renderer/index.html /tmp/probe \
//     '[{"name":"w1280-light","w":1280,"h":700,"theme":"light"}]' 1200
//
// 输出:
//   <outDir>/<name>.png      截图
//   <outDir>/metrics.json    逐视口实测数字（含 errors）
//
// 前置：被测页面须是**构建产物**（out/renderer/index.html）——源文件用绝对
// `/app.js` 引用；构建后才是相对 assets 路径。先跑 electron-vite build。
//
// 设计纪律：断言口径写死在这里，避免「先看图再想判据」的事后合理化。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const HTTP_PORT = Number(process.env.PROBE_HTTP_PORT || 8791);
const PROFILE = process.env.CDP_PROFILE || '/tmp/dsh-cdp-profile';

const [, , htmlPath, outDir, jobsJson, delayArg] = process.argv;
if (!htmlPath || !outDir || !jobsJson) {
  console.error("用法: node proto/cdp-probe.mjs <htmlPath> <outDir> '<jobsJson>' [delayMs]");
  process.exit(2);
}
const jobs = JSON.parse(jobsJson);
const delay = Number(delayArg || 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = path.dirname(path.resolve(htmlPath));
const PAGE = '/' + path.basename(htmlPath);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// —— 内置静态服务（只读，仅本机回环）——
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// 在渲染进程里跑的测量脚本：只读 DOM，不改任何状态
const MEASURE = `
(() => {
  const px = (el) => (el ? Math.round(el.getBoundingClientRect().width) : -1);
  // 注意：px 量的是「宽」不是「高」。名字里的 p- 是 pixel 不是 padding。
  // 量高度必须用下面的 ph，别再拿 px 冒充 H 字段（曾把 statusbar 宽度 1280 当成高度）。
  const ph = (el) => (el ? Math.round(el.getBoundingClientRect().height) : -1);
  const vis = (el) => {
    if (!el) return 'absent';
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return 'display:none';
    if (cs.visibility === 'hidden') return 'hidden';
    if (parseFloat(cs.opacity) === 0) return 'opacity:0';
    return 'visible';
  };
  const q = (s) => document.querySelector(s);
  const sidebar = q('.sidebar');
  const drawer = q('.drawer');
  const gutter = q('.gutter');
  const shell = q('.shell');
  const sTxt = q('.session .s-txt');
  const rect = (el) => {
    if (!el) return 'absent';
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
  };
  let readableTitles = 0;
  document.querySelectorAll('.session .s-txt').forEach((el) => {
    if (vis(el) === 'visible' && px(el) >= 24) readableTitles += 1;
  });
  const qc = document.querySelector('.quick-card');
  const launcher = q('.side-launcher');
  const drawerBody = q('#drawerBody');
  return {
    viewport: window.innerWidth + 'x' + window.innerHeight,
    sidebarW: px(sidebar),
    sidebarPos: sidebar ? getComputedStyle(sidebar).position : 'absent',
    drawerW: px(drawer),
    drawerPos: drawer ? getComputedStyle(drawer).position : 'absent',
    drawerRect: rect(drawer),
    drawerCount: document.querySelectorAll('.drawer').length,
    drawerParent: drawer && drawer.parentElement
      ? drawer.parentElement.tagName.toLowerCase() + '.' + String(drawer.parentElement.className)
      : 'absent',
    shellChildren: shell ? [...shell.children].map((c) => c.tagName.toLowerCase() + '.' + String(c.className)) : 'absent',
    bodyChildren: [...document.body.children].map((c) => c.tagName.toLowerCase() + '.' + String(c.className).slice(0, 24)),
    streamParent: (() => {
      const s = document.querySelector('.stream');
      return s && s.parentElement ? s.parentElement.tagName.toLowerCase() + '.' + String(s.parentElement.className) : 'absent';
    })(),
    drawerAncestors: (() => {
      const chain = [];
      let el = drawer;
      while (el && el !== document.body && chain.length < 8) {
        const cs = getComputedStyle(el);
        chain.push((el.tagName.toLowerCase()) + '.' + String(el.className) + '[' + cs.display + '/' + cs.flexDirection + ']');
        el = el.parentElement;
      }
      return chain;
    })(),
    composerCount: document.querySelectorAll('.composer').length,
    composerParent: (() => {
      const c = q('.composer');
      return c && c.parentElement ? c.parentElement.tagName.toLowerCase() + '.' + String(c.parentElement.className) : 'absent';
    })(),
    chatChildren: (() => {
      const c = q('main.chat') || q('.chat');
      return c ? [...c.children].map((x) => x.tagName.toLowerCase() + '.' + String(x.className)) : 'absent';
    })(),
    bodyChildRects: [...document.body.children].map((el) => {
      const r = el.getBoundingClientRect();
      return el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 20) + '@y' + Math.round(r.y) + ',h' + Math.round(r.height);
    }).slice(0, 12),
    drawerCollapsed: drawer ? drawer.classList.contains('collapsed') : 'absent',
    drawerBodyEmpty: drawerBody ? String(drawerBody.dataset.empty) : 'absent',
    launcherVis: vis(launcher),
    quickCardCount: document.querySelectorAll('.quick-card').length,
    quickCardVis: vis(qc),
    quickCardRect: rect(qc),
    gutterDisplay: gutter ? getComputedStyle(gutter).display : 'absent',
    shellRect: rect(shell),
    streamRect: rect(q('.stream')),
    streamInnerW: px(q('.stream-inner')),
    streamInnerRect: rect(q('.stream-inner')),
    composerW: px(q('.composer')),
    composerVis: vis(q('.composer')),
    contentMax: shell ? getComputedStyle(shell).getPropertyValue('--content-max').trim() : 'n/a',
    // S-1 内部嵌套校验（2026-09-17 追加，纯增量字段，不改动既有口径）：
    // 顶层归位有两种修法，内部嵌套不同；必须能区分，否则「修好顶层、弄坏内层」会被放过。
    msgActionsParent: (() => {
      const m = document.querySelector('.msg-actions');
      return m && m.parentElement ? m.parentElement.tagName.toLowerCase() + '.' + String(m.parentElement.className) : 'absent';
    })(),
    msgBodyCount: document.querySelectorAll('.msg-body').length,
    tgBodyCount: document.querySelectorAll('.tg-body').length,
    // 内部嵌套的判别字段（.msg-actions 的 parent 在「修好」与「未修」两态下都是
    // div.msg-body，实测不具判别力，故改用下面这两项）：
    streamInnerKids: (() => {
      const s = document.querySelector('.stream-inner');
      return s ? [...s.children].map((c) => c.tagName.toLowerCase() + '.' + String(c.className).slice(0, 18)) : 'absent';
    })(),
    msgAiParent: (() => {
      const m = document.querySelector('.msg.ai[data-stream]') || document.querySelector('.msg.ai');
      return m && m.parentElement ? m.parentElement.tagName.toLowerCase() + '.' + String(m.parentElement.className) : 'absent';
    })(),
    msgAiRect: (() => {
      const m = document.querySelector('.msg.ai[data-stream]') || document.querySelector('.msg.ai');
      if (!m) return 'absent';
      const r = m.getBoundingClientRect();
      return Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
    })(),
    streamInnerParent: (() => {
      const s = document.querySelector('.stream-inner');
      return s && s.parentElement ? s.parentElement.tagName.toLowerCase() + '.' + String(s.parentElement.className) : 'absent';
    })(),
    chatTag: (() => {
      const c = document.querySelector('main.chat') || document.querySelector('.chat');
      return c ? c.tagName.toLowerCase() + '.' + String(c.className) : 'absent';
    })(),
    sessionCount: document.querySelectorAll('.session').length,
    // 底栏 VIS-02（2026-09-17 追加，纯增量）：statusbar 高度/可见性、事件计数文本，
    // 以及底栏项的实际高度——用于验证 sb-item 类名冲突（会话操作菜单也占用该名）已修好。
    // 注意：本块整体位于模板字面量内，注释里绝不能出现反引号（会提前截断模板）。
    statusbarVis: vis(q('#statusbar')),
    statusbarH: ph(q('#statusbar')),
    eventCountText: q('#eventCount') ? q('#eventCount').textContent : 'absent',
    sbItemH: ph(q('#statusbar .sb-item')),
    sbItemFont: q('#statusbar .sb-item') ? getComputedStyle(q('#statusbar .sb-item')).fontSize : 'absent',
    gitQuickCardCount: document.querySelectorAll('.quick-card[data-view="git"]').length,
    firstTitleVis: vis(sTxt),
    firstTitleW: px(sTxt),
    readableTitles,
    newChatTextVis: vis(q('.new-chat')),
    archiveTextVis: vis(q('.archive-toggle')),
    ariaLiveCount: document.querySelectorAll('[aria-live]').length,
    docTheme: document.documentElement.dataset.theme || '(none)',
    bodyScrollW: document.body.scrollWidth,
    errors: (window.__probeErrors || []).slice(0, 5),
  };
})()
`;

// 在页面任何脚本之前注入：采集运行时错误
const ERROR_HOOK = `
  window.__probeErrors = [];
  window.addEventListener('error', (e) => {
    window.__probeErrors.push('error: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    window.__probeErrors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason));
  });
`;

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).slice().forEach((h) => h(msg.params, msg.sessionId));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method) {
    return new Promise((resolve) => {
      const arr = this.handlers.get(method) || [];
      const h = (p, s) => {
        this.handlers.set(method, arr.filter((x) => x !== h));
        resolve({ params: p, sessionId: s });
      };
      arr.push(h);
      this.handlers.set(method, arr);
    });
  }
}

async function waitFor(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (_) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('not ready: ' + url);
}

await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${HTTP_PORT}${PAGE}`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

let exitCode = 0;
try {
  const ver = await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws connect failed')), { once: true });
  });
  const cdp = new CDP(ws);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: ERROR_HOOK }, sessionId);
  // 激活应用自带的 prefers-reduced-motion 分支（15 处），避免手工冻动画造成伪影
  await cdp.send('Emulation.setEmulatedMedia', {
    media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  }, sessionId);
  // 模拟减动效偏好：激活应用自带的 @media (prefers-reduced-motion: reduce) 分支，
  // 这些分支在应用侧就是为「冻结后仍然正确」设计的，比探针自行覆盖动画可靠。
  await cdp.send('Emulation.setEmulatedMedia', {
    media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  }, sessionId);

  fs.mkdirSync(outDir, { recursive: true });
  const metrics = [];
  console.log('serving ' + ROOT + '  ->  ' + pageUrl);

  for (const j of jobs) {
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: j.w, height: j.h, deviceScaleFactor: 1, mobile: false,
      }, sessionId);

      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: pageUrl }, sessionId);
      await Promise.race([loaded, sleep(15000)]);
      await sleep(500);

      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          document.documentElement.dataset.theme = ${JSON.stringify(j.theme)};
          // 走应用自带的减动效通道（html.reduce-motion + prefers-reduced-motion 模拟），
          // 不要用 *{animation:none}——那会把 animation-fill-mode:both 的元素钉死在
          // 首帧（.quick-card 基态 opacity:0），测出「卡片不可见」的伪影。
          document.documentElement.classList.add('reduce-motion');
          const s = document.createElement('style');
          s.textContent = '*{transition:none!important}';
          document.head.appendChild(s);
          return true;
        })()`,
        returnByValue: true,
      }, sessionId);
      await sleep(delay);

      // 可选 prep：进入某个交互态后再测量（如打开侧栏抽屉 / 展开右板 Sheet）
      if (j.prep) {
        const pr = await cdp.send('Runtime.evaluate', { expression: j.prep, returnByValue: true }, sessionId);
        if (pr.exceptionDetails) throw new Error('prep threw: ' + JSON.stringify(pr.exceptionDetails).slice(0, 200));
        await sleep(300);
      }

      const r = await cdp.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error('measure threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
      const m = { ...r.result.value, job: j.name, theme: j.theme };
      metrics.push(m);

      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.writeFileSync(path.join(outDir, j.name + '.png'), Buffer.from(shot.data, 'base64'));
      console.log('OK  ' + j.name + '  ' + JSON.stringify(m));
    } catch (e) {
      exitCode = 1;
      console.log('ERR ' + j.name + '  ' + e.message);
      metrics.push({ job: j.name, theme: j.theme, error: e.message });
    }
  }

  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log('--- metrics.json: ' + path.join(outDir, 'metrics.json'));
} catch (e) {
  exitCode = 1;
  console.log('FATAL ' + e.message);
} finally {
  try { chrome.kill('SIGKILL'); } catch (_) { /* already gone */ }
  server.close();
}
process.exit(exitCode);
