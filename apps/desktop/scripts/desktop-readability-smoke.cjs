// Real Electron renderer with synthetic AgentApi and a disposable profile; no provider calls.
// env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron scripts/desktop-readability-smoke.cjs [output]
const { app, BrowserWindow, nativeTheme } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const profile = mkdtempSync(join(tmpdir(), 'cairn-readability-profile-'));
const out = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'cairn-readability-')));
app.setPath('userData', profile);
app.on('quit', () => rmSync(profile, { recursive: true, force: true }));
mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: ok === true, detail });
  console.log(`${ok === true ? 'PASS' : 'FAIL'} ${name}${ok === true ? '' : ' ' + JSON.stringify(detail)}`);
};
const pause = (ms = 250) => new Promise(r => setTimeout(r, ms));
async function main() {
  await app.whenReady();
  nativeTheme.themeSource = 'light';
  const source = readFileSync(join(__dirname, '../../../src/main/ipc-protocol.ts'), 'utf8');
  const version = Number(source.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = source.indexOf('export interface AgentApi');
  const body = source.slice(start, source.indexOf('\n}', start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    backgroundThrottling: false, preload: join(__dirname, 'ui-gallery-preload.cjs'),
    additionalArguments: ['--cairn-api-members=' + JSON.stringify(members), '--cairn-protocol-version=' + version, '--cairn-theme=light'],
  } });
  win.webContents.on('console-message', details => { if (details.level === 'error') { errors.push(details.message); console.error(details.message); } });
  const js = text => win.webContents.executeJavaScript(text, true);
  const click = async selector => {
    const point = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error('Missing '+${JSON.stringify(selector)}); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await pause();
  };
  const shot = async name => writeFileSync(join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, '../dist/index.html'));
  for (let i = 0; i < 60; i++) { if (await js(`!!document.querySelector('.session')`)) break; await pause(100); }
  await click('.session');
  for (let i = 0; i < 60; i++) { if (await js(`!!document.querySelector('.row.assistant .md-code code')`)) break; await pause(100); }
  await js('document.fonts.ready');
  const fonts = await js(`(() => {
    const prose = document.querySelector('.row.assistant .md-body');
    const code = prose?.querySelector('.md-code code');
    if (!prose || !code) throw Error('Fixture must contain prose and code');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    ctx.font = getComputedStyle(code).font;
    const narrow = ctx.measureText('iiiiiiii').width, wide = ctx.measureText('WWWWWWWW').width;
    return { loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
      ui: getComputedStyle(document.body).fontFamily, prose: getComputedStyle(prose).fontFamily,
      table: getComputedStyle(prose.querySelector('td')).fontFamily, code: getComputedStyle(code).fontFamily, narrow, wide };
  })()`);
  check('Inter and JetBrains Mono load from the offline bundle', fonts.loaded.includes('Claude Style Inter') && fonts.loaded.includes('JetBrains Mono'), fonts);
  check('prose and table share the UI sans family', fonts.prose === fonts.ui && fonts.table === fonts.ui, fonts);
  check('code is actually monospaced', Math.abs(fonts.narrow - fonts.wide) < 0.1, fonts);
  await js(`document.querySelector('.stream').scrollTop = 0`);
  for (const theme of ['light', 'dark']) {
    await js(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.dataset.mode = ${JSON.stringify(theme)}; document.body.toggleAttribute('data-ds-dark-theme', ${theme === 'dark'}); document.body.toggleAttribute('data-dsw-dark-theme', ${theme === 'dark'}); })()`);
    await pause(); // Read settled colors after the existing hover/color transitions.
    const contrast = await js(`(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map(v => v / 255); };
      const blend = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3]));
      const lum = rgb => rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      return ['.s-time', '.s-bucket', '.add-project-btn', '.composer-card textarea'].map(selector => {
        const el = document.querySelector(selector); if (!el) throw Error('Missing contrast target: ' + selector);
        const chain = []; for (let n = el; n; n = n.parentElement) chain.unshift(n);
        const bg = chain.reduce((base, n) => blend(rgba(getComputedStyle(n).backgroundColor), base), [1, 1, 1]);
        const fg = blend(rgba(getComputedStyle(el, el.tagName === 'TEXTAREA' ? '::placeholder' : null).color), bg);
        const a = lum(fg), b = lum(bg);
        return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    })()`);
    check(theme + ': sidebar metadata and input hint meet 4.5:1 contrast', contrast.every(c => c.ratio >= 4.5), contrast);
    for (const [width, height] of [[1440, 900], [1120, 720], [880, 640]]) {
      win.setContentSize(width, height); await pause();
      const layout = await js(`(() => {
        const composer = document.querySelector('.composer-card').getBoundingClientRect();
        const buttons = ['.g-more', '.g-new', '.s-more', '.s-bucket'].map(selector => {
          const el = document.querySelector(selector); const r = el?.getBoundingClientRect();
          return { selector, width: r?.width ?? 0, height: r?.height ?? 0 };
        });
        return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
          composer: { left: composer.left, right: composer.right, bottom: composer.bottom }, height: innerHeight, buttons };
      })()`);
      check(theme + ' ' + width + ': composer stays within the window', !layout.overflow && layout.composer.left >= 0 && layout.composer.right <= layout.width && layout.composer.bottom <= layout.height, layout);
      check(theme + ' ' + width + ': sidebar actions have 28px targets', layout.buttons.every(b => b.width >= 28 && b.height >= 28), layout.buttons);
      await shot('conversation-' + theme + '-' + width);
    }
  }
  await js(`document.querySelector('.s-more').focus()`);
  check('keyboard focus reveals the session action', await js(`document.activeElement === document.querySelector('.s-more') && getComputedStyle(document.activeElement).display !== 'none'`));
  await click('.mp-trigger');
  check('model menu remains reachable', await js(`!!document.querySelector('.mp-pop')`));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await pause();
  check('Escape closes the menu and returns focus', await js(`!document.querySelector('.mp-pop') && document.activeElement === document.querySelector('.mp-trigger')`));
  check('renderer has no console errors', errors.length === 0, errors);
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ syntheticData: true, fonts, checks, errors }, null, 2));
  win.destroy();
  app.exit(checks.every(c => c.ok) ? 0 : 1);
}
setTimeout(() => { console.error('readability smoke timeout'); app.exit(2); }, 45000).unref();
main().catch(error => { console.error(error); writeFileSync(join(out, 'failure.txt'), String(error.stack || error)); app.exit(1); });
