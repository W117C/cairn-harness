// 壁纸 CSP 与设置行的真机冒烟（2026-11-15）。
//
// 为什么必须有这一支：壁纸能不能出现，取决于**三件事同时成立**——渲染层拼的 URL、主进程登记的
// scheme、构建产物里那份 CSP 的白名单。前两件有单测，第三件此前只有源码文本判据；而漏一个 scheme
// 的表现是「选了壁纸但什么也没变」（img onError ⇒ 撤层），无异常、无红字。所以这里在真 Electron 里
// 出一次网，并且带一条**反证臂**：把 CSP 里的 scheme 摘掉，同一张图必须加载不出来。
//
// 口径：真构建产物（dist/index.html 带生产 CSP）＋ 真壁纸协议（scheme 登记与 handler 都调生产模块
// src/main/wallpaper.ts）＋ 合成 AgentApi（壁纸与 agent 核心无关）。隔离 profile，不碰产品用户数据。
//
// 跑法：pnpm --filter cairn-desktop build
//       pnpm --filter cairn-desktop exec electron scripts/wallpaper-csp-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme, net, protocol } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const zlib = require("node:zlib");

const repoRoot = resolve(__dirname, "../../..");
require(require.resolve("tsx/cjs", { paths: [repoRoot] }));
// 生产模块，不是复刻：scheme 特权与 handler 的语义都必须与产品一致。
const { handleWallpaperMedia, openWallpaperStream, registerWallpaperScheme, WALLPAPER_SCHEME } =
  require(join(__dirname, "../src/main/wallpaper.ts"));
const { CSP_CONTENT } = require(join(__dirname, "../src/main/csp.ts"));

const profile = mkdtempSync(join(tmpdir(), "cairn-wallpaper-csp-profile-"));
app.setPath("userData", profile);
app.on("quit", () => scheduleProfileCleanup(profile));
nativeTheme.themeSource = "dark";
const out = resolve(repoRoot, process.argv[2] || mkdtempSync(join(tmpdir(), "cairn-wallpaper-csp-evidence-")));
mkdirSync(out, { recursive: true });

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: ok === true, detail: detail ?? null });
  console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? null)}`);
};
const pause = (ms = 160) => new Promise((r) => setTimeout(r, ms));
const readings = {};

// 测试壁纸：纯 Node 生成的对角渐变 PNG（不依赖 Python / ffmpeg）。一张图里同时含亮端与暗端。
function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function gradientPng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      raw[p++] = Math.round(255 * t);
      raw[p++] = Math.round(140 * (1 - t));
      raw[p++] = Math.round(255 * (1 - t));
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const wallpaperPath = join(out, "fixture-wallpaper.png");
writeFileSync(wallpaperPath, gradientPng(640, 400));

// 主进程侧的「当前壁纸」：与产品同形——handler 只服务这一个路径。
let currentPath = wallpaperPath;
registerWallpaperScheme((entry) => { protocol.registerSchemesAsPrivileged([entry]); });

const distDir = join(__dirname, "../dist");
const html = readFileSync(join(distDir, "index.html"), "utf8");

function apiMembers() {
  const source = readFileSync(join(repoRoot, "src/main/ipc-protocol.ts"), "utf8");
  const version = Number(source.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = source.indexOf("export interface AgentApi");
  const body = source.slice(start, source.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({
    name: m[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)),
  }));
  return { version, members };
}

async function makeWindow(indexPath, errors) {
  const { version, members } = apiMembers();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-wallpaper-fixture=" + wallpaperPath,
        "--cairn-theme=dark",
      ],
    },
  });
  win.webContents.on("console-message", (d) => {
    if (d.level === "error") errors.push(d.message);
  });
  await win.loadFile(indexPath);
  return win;
}

const jsOf = (win) => (source) => win.webContents.executeJavaScript(source, true);
const shot = async (win, name) => {
  await pause(220);
  writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
};
const centerOf = (win, selector) => jsOf(win)(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error("Missing " + ${JSON.stringify(selector)});
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
})()`);
// 真指针：先命中测试（elementFromPoint），再发真鼠标事件——脚本 .click() 会绕过 inert 与遮挡。
const pointerClick = async (win, selector, fx = 0.5) => {
  const box = await centerOf(win, selector);
  const point = { x: Math.round(box.x - box.w / 2 + box.w * fx), y: box.y };
  const hit = await jsOf(win)(`(() => {
    const el = document.elementFromPoint(${point.x}, ${point.y});
    const target = document.querySelector(${JSON.stringify(selector)});
    return { tag: el ? el.tagName : null, cls: el ? el.className : null,
             hits: !!el && (el === target || target.contains(el) || el.contains(target)) };
  })()`);
  win.webContents.sendInputEvent({ type: "mouseMove", ...point });
  win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  await pause(240);
  return { point, hit };
};

async function main() {
  await app.whenReady();
  protocol.handle(WALLPAPER_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "media" || url.pathname !== "/current") return new Response("not found", { status: 404 });
    return handleWallpaperMedia({ currentPath, range: request.headers.get("range"), open: openWallpaperStream });
  });

  // ① 构建产物里的 CSP 与模块真值逐字一致，且两条媒体指令都放行了 scheme。
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
  const built = meta === null ? "" : meta[1];
  readings.builtCsp = built;
  check("构建产物 CSP 与 src/main/csp.ts 的真值逐字一致", built === CSP_CONTENT, { equal: built === CSP_CONTENT });
  const origin = `${WALLPAPER_SCHEME}:`;
  const directiveOf = (name) => built.split("; ").find((p) => p.startsWith(`${name} `)) ?? "";
  check("img-src 与 media-src 都放行壁纸 scheme", ["img-src", "media-src"].every((d) => directiveOf(d).includes(origin)), {
    imgSrc: directiveOf("img-src"), mediaSrc: directiveOf("media-src"),
  });
  check("connect-src 不放壁纸 scheme（渲染层不从它 fetch）", !directiveOf("connect-src").includes(origin), {
    connectSrc: directiveOf("connect-src"),
  });

  // ② 协议白名单与 Range：真 Electron 里出网（此前只有假流单测）。
  const base = `${WALLPAPER_SCHEME}://media/current`;
  const full = await net.fetch(base);
  const fullBytes = (await full.arrayBuffer()).byteLength;
  const ranged = await net.fetch(base, { headers: { range: "bytes=0-99" } });
  const rangedBytes = (await ranged.arrayBuffer()).byteLength;
  const wrongPath = await net.fetch(`${WALLPAPER_SCHEME}://media/other`);
  const badRange = await net.fetch(base, { headers: { range: "bytes=99999999-" } });
  readings.protocol = {
    full: { status: full.status, bytes: fullBytes, type: full.headers.get("content-type"), acceptRanges: full.headers.get("accept-ranges") },
    ranged: { status: ranged.status, bytes: rangedBytes, contentRange: ranged.headers.get("content-range") },
    wrongPath: wrongPath.status,
    badRange: badRange.status,
  };
  check("当前壁纸 200 + 真实字节数 + accept-ranges", full.status === 200 && fullBytes === readFileSync(wallpaperPath).length && full.headers.get("accept-ranges") === "bytes", readings.protocol.full);
  check("Range 请求回 206 且 content-range 正确", ranged.status === 206 && rangedBytes === 100 && ranged.headers.get("content-range") === `bytes 0-99/${fullBytes}`, readings.protocol.ranged);
  check("非当前路径 404（白名单＝设置里那一个文件）", wrongPath.status === 404, { status: wrongPath.status });
  check("越界 Range 416", badRange.status === 416, { status: badRange.status });

  // ③ 真渲染层：壁纸图必须真的解码出来。
  const errors = [];
  const win = await makeWindow(join(distDir, "index.html"), errors);
  const js = jsOf(win);
  for (let i = 0; i < 100; i++) { if (await js(`!!document.querySelector('.avatar')`)) break; await pause(); }
  await pause(400);
  const layer = await js(`(() => {
    const img = document.querySelector('.cw-layer img.cw-media');
    const cs = getComputedStyle(document.body);
    const main = document.querySelector('.main');
    return {
      layer: !!document.querySelector('.cw-layer'),
      kind: document.querySelector('.cw-layer')?.dataset.kind ?? null,
      src: img ? img.currentSrc : null,
      natural: img ? [img.naturalWidth, img.naturalHeight] : null,
      complete: img ? img.complete : null,
      bodyBg: cs.backgroundColor,
      bodyAttr: document.body.hasAttribute('data-we-wallpaper'),
      htmlAttr: document.documentElement.hasAttribute('data-cairn-wallpaper'),
      mainBackdrop: main ? getComputedStyle(main).backdropFilter : null,
      floor: getComputedStyle(document.documentElement).getPropertyValue('--cw-floor').trim(),
      wallpaperOpacity: getComputedStyle(document.documentElement).getPropertyValue('--cw-wallpaper-opacity').trim(),
    };
  })()`);
  readings.layer = layer;
  check("壁纸图真加载（naturalWidth>0，地址走壁纸协议）",
    layer.natural !== null && layer.natural[0] > 0 && layer.natural[1] > 0 && String(layer.src).startsWith(`${WALLPAPER_SCHEME}://`), layer);
  check("开壁纸时 body 画布透明、两个接缝属性都在",
    layer.bodyBg === "rgba(0, 0, 0, 0)" && layer.bodyAttr && layer.htmlAttr, { bodyBg: layer.bodyBg, bodyAttr: layer.bodyAttr, htmlAttr: layer.htmlAttr });
  check("玻璃面拿到 backdrop-filter，地板变量已算出",
    layer.mainBackdrop !== null && layer.mainBackdrop !== "none" && layer.floor !== "", { mainBackdrop: layer.mainBackdrop, floor: layer.floor });
  const cspErrors = errors.filter((m) => /Content Security Policy/i.test(m));
  check("真渲染层无 CSP 违规", cspErrors.length === 0, { cspErrors, errorCount: errors.length });
  await shot(win, "01-wallpaper-on-dark-1440x900");

  // ④ 设置行：三族样式必须真的落到布局上（不是裸 HTML）。
  await js(`(() => { if (!document.querySelector('.sp-page')) window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', metaKey: true, bubbles: true })); })()`);
  await pause(400);
  if (!(await js(`!!document.querySelector('.sp-page')`))) {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
    await pause(400);
  }
  await js(`(() => { const el = [...document.querySelectorAll('.sp-nav-item')].find((n) => n.textContent.trim() === '通用'); if (el) el.click(); })()`);
  await pause(300);
  await js(`document.querySelector('.cw-settings')?.scrollIntoView({ block: 'center' })`);
  await pause(260);
  const row = await js(`(() => {
    const wrap = document.querySelector('.cw-settings');
    if (!wrap) return { found: false };
    const wcs = getComputedStyle(wrap);
    const sliders = [...wrap.querySelectorAll('.cw-slider')].map((s) => {
      const span = s.querySelector('span');
      const input = s.querySelector('input[type="range"]');
      const scs = getComputedStyle(s);
      const ir = input.getBoundingClientRect();
      const sr = span.getBoundingClientRect();
      return {
        label: span.textContent.trim(),
        columns: scs.gridTemplateColumns,
        display: scs.display,
        top: Math.round(s.getBoundingClientRect().top),
        labelWidth: Math.round(sr.width),
        labelLines: span.getClientRects().length,
        rangeWidth: Math.round(ir.width),
        rangeHeight: Math.round(ir.height),
        accent: getComputedStyle(input).accentColor,
        value: input.value,
      };
    });
    const buttons = [...wrap.querySelectorAll('.cw-settings-actions button')].map((b) => ({
      text: b.textContent.trim(),
      width: Math.round(b.getBoundingClientRect().width),
      bg: getComputedStyle(b).backgroundColor,
      color: getComputedStyle(b).color,
    }));
    const page = document.querySelector('.sp-page');
    return {
      found: true, display: wcs.display, direction: wcs.flexDirection,
      actionsDisplay: getComputedStyle(wrap.querySelector('.cw-settings-actions')).display,
      status: wrap.querySelector('.cw-settings-actions .ss-static')?.textContent.trim() ?? null,
      pageBg: page ? getComputedStyle(page).backgroundColor : null,
      sliders, buttons,
      rowWidth: Math.round(wrap.getBoundingClientRect().width),
      containerWidth: Math.round(document.querySelector('.sp-body')?.getBoundingClientRect().width ?? 0),
    };
  })()`);
  readings.settingsRow = row;
  check("设置整页不让位：.sp-page 保持实体底色（否则工作台文字叠在设置文字下）",
    row.found && row.pageBg !== null && row.pageBg !== "rgba(0, 0, 0, 0)" && row.pageBg !== "transparent", { pageBg: row.pageBg });
  check("设置行三族都有布局：.cw-settings 纵向、.cw-slider 两列网格",
    row.found && row.display === "flex" && row.direction === "column"
    && row.sliders.length === 3 && row.sliders.every((s) => s.display === "grid" && s.columns.split(" ").length === 2), row);
  check("三个滑杆各占一行（top 互不相同）且标签单行有文字",
    row.found && new Set(row.sliders.map((s) => s.top)).size === 3
    && row.sliders.every((s) => s.label.length > 0 && s.labelLines === 1), row.sliders);
  check("滑杆本体够宽（≥200px，控件 md 档）且拿到主题强调色",
    row.found && row.sliders.every((s) => s.rangeWidth >= 200 && s.accent !== "" && s.accent !== "auto"), row.sliders);
  check("已设壁纸时按钮读动作词「选择图片或视频」，不读状态词「未设置」",
    row.found && row.buttons.length === 2 && row.buttons[0].text === "选择图片或视频" && row.status === null, row.buttons);
  check("选/清两个按钮可见且有底色（不是透明白字）",
    row.found && row.buttons.length >= 1 && row.buttons.every((b) => b.width > 0 && b.bg !== "rgba(0, 0, 0, 0)"), row.buttons);
  await shot(win, "02-settings-wallpaper-row-1440x900");

  // ⑤ 真指针可达 + 真点击改值（脚本 .click() 不算）。
  const sliderProbe = await pointerClick(win, ".cw-slider:nth-of-type(1) input[type='range']", 0.2);
  const afterSlider = await js(`(() => {
    const input = document.querySelector('.cw-slider input[type="range"]');
    const calls = window.__cairnSettingsCalls ? window.__cairnSettingsCalls() : [];
    return { value: input.value, lastPatch: calls.length ? calls[calls.length - 1] : null };
  })()`);
  readings.sliderPointer = { ...sliderProbe, ...afterSlider };
  check("第一个滑杆真指针命中本体", sliderProbe.hit.hits, sliderProbe.hit);
  check("真鼠标点滑杆改到了值并落进 setSettings（opacity）",
    Number(afterSlider.value) < 0.5 && afterSlider.lastPatch !== null && afterSlider.lastPatch.wallpaper !== undefined
    && Math.abs(afterSlider.lastPatch.wallpaper.opacity - Number(afterSlider.value)) < 1e-6, afterSlider);

  const pickProbe = await pointerClick(win, ".cw-settings-actions button:nth-of-type(1)");
  const afterPick = await js(`(() => ({
    picks: window.__cairnWallpaper ? window.__cairnWallpaper.picks() : -1,
    revision: null,
    layer: !!document.querySelector('.cw-layer'),
  }))()`);
  readings.pickPointer = { ...pickProbe, ...afterPick };
  check("选壁纸按钮真指针命中并调到 wallpaperPick", pickProbe.hit.hits && afterPick.picks >= 1, readings.pickPointer);

  const clearProbe = await pointerClick(win, ".cw-settings-actions button:nth-of-type(2)");
  await pause(300);
  const afterClear = await js(`(() => ({
    layer: !!document.querySelector('.cw-layer'),
    bodyAttr: document.body.hasAttribute('data-we-wallpaper'),
    htmlAttr: document.documentElement.hasAttribute('data-cairn-wallpaper'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    backdrop: getComputedStyle(document.querySelector('.main')).backdropFilter,
    status: document.querySelector('.cw-settings-actions .ss-static')?.textContent.trim() ?? null,
    buttons: [...document.querySelectorAll('.cw-settings-actions button')].map((b) => b.textContent.trim()),
  }))()`);
  readings.clearPointer = { ...clearProbe, ...afterClear };
  check("清除按钮真指针命中；清除后撤层、摘属性、画布回实体色",
    clearProbe.hit.hits && !afterClear.layer && !afterClear.bodyAttr && !afterClear.htmlAttr && afterClear.bodyBg !== "rgba(0, 0, 0, 0)", afterClear);
  check("清除后状态词「未设置」出现、清除按钮收起、选按钮仍是动作词",
    afterClear.status === "未设置" && afterClear.buttons.length === 1 && afterClear.buttons[0] === "选择图片或视频", afterClear);
  await shot(win, "03-wallpaper-cleared-1440x900");

  // ⑥ 反证臂：同一份产物、只把 img-src 里的 scheme 摘掉 ⇒ 同一张图必须加载不出来。
  const negativeDir = mkdtempSync(join(tmpdir(), "cairn-wallpaper-csp-negative-"));
  cpSync(distDir, negativeDir, { recursive: true });
  const negativeHtml = readFileSync(join(negativeDir, "index.html"), "utf8")
    .replace(`img-src 'self' data: blob: https: ${origin}`, "img-src 'self' data: blob: https:");
  writeFileSync(join(negativeDir, "index.html"), negativeHtml);
  const negativeErrors = [];
  const negativeWin = await makeWindow(join(negativeDir, "index.html"), negativeErrors);
  const njs = jsOf(negativeWin);
  for (let i = 0; i < 100; i++) { if (await njs(`!!document.querySelector('.avatar')`)) break; await pause(); }
  await pause(700);
  const negative = await njs(`(() => {
    const img = document.querySelector('.cw-layer img.cw-media');
    return { layer: !!document.querySelector('.cw-layer'), natural: img ? img.naturalWidth : null,
             bodyAttr: document.body.hasAttribute('data-we-wallpaper') };
  })()`);
  const negativeCsp = negativeErrors.filter((m) => /Content Security Policy/i.test(m));
  readings.negativeControl = { ...negative, cspViolations: negativeCsp.length, sample: negativeCsp[0] ?? null };
  check("反证：摘掉 img-src 的 scheme 后图加载不出来（判据承重）",
    (negative.natural === null || negative.natural === 0) && negativeCsp.length > 0, readings.negativeControl);
  await shot(negativeWin, "04-negative-control-no-scheme-1440x900");
  negativeWin.destroy();

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  writeFileSync(join(out, "readings.json"), JSON.stringify(readings, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => f.name).join("；"));
    app.exit(1);
    return;
  }
  app.quit();
}

const watchdog = setTimeout(() => {
  console.error("wallpaper-csp-smoke watchdog：180s 未收束");
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  app.exit(1);
}, 180_000);

main().then(() => clearTimeout(watchdog)).catch((err) => {
  clearTimeout(watchdog);
  console.error("wallpaper-csp-smoke FAILED:", err instanceof Error ? err.stack : String(err));
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  app.exit(1);
});