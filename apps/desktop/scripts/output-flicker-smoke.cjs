// 输出流式「不闪」真机冒烟（2026-11-08 第 1043 页，接业主「大模型输出信息总是一闪一闪的需要修复」）：
// 离屏 Electron + 画廊桩（不跑真模型），按真实 delta 粒度逐词推一段含换行/列表/加粗的流式正文。
// 病因：流式按累计全文重解析，块结构一变「正在写的那一块」就易主 ⇒ 已输出的词在 md-word span
// 与纯文本之间反复重挂，入场动画被反复重播；旧的「透明 + 品牌橙」关键帧因此读成整段明灭色闪。
// 判据（每拍都量，暗/亮各一趟）：① 所有 .md-word 的 computed opacity 恒 1；② 词色是中性 text-000
// 墨（含 62% alpha 的渐落态），绝不落到品牌橙；③ 入场动效仍在（animationName=md-word-arrive）；
// ④ 助手行自身 opacity 恒 1；⑤ 末尾收束后历史正文不多包 md-word 节点。
// 用法：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE electron scripts/output-flicker-smoke.cjs [outDir]
//       THEME=light|dark（默认 dark）。
const electron = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (electron === null || typeof electron !== "object" || electron.app === undefined) {
  console.error("[flicker-smoke] 需要真 Electron：env -u ELECTRON_RUN_AS_NODE electron scripts/output-flicker-smoke.cjs");
  process.exit(2);
}
const { app, BrowserWindow, nativeTheme } = electron;
const { mkdtempSync, readFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const THEME = process.env.THEME === "light" ? "light" : "dark";
const profile = mkdtempSync(join(tmpdir(), "cairn-flicker-smoke-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = THEME;
app.on("quit", () => scheduleProfileCleanup(profile));
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), `cairn-flicker-smoke-${THEME}-`)));
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const errors = [];

async function main() {
  await app.whenReady();
  const watchdog = setTimeout(() => { console.error("[flicker-smoke] 超时 120s 自退"); app.exit(1); }, 120_000);
  watchdog.unref?.();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false, offscreen: true,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-steer-fixture",
        "--cairn-theme=" + THEME,
      ],
    },
  });
  win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) errors.push(message); });
  win.webContents.on("render-process-gone", (_e, details) => errors.push("gone: " + JSON.stringify(details)));
  const js = (source) => win.webContents.executeJavaScript(source);
  const waitFor = async (source, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await js(source)) return; await pause(20); }
    throw new Error("Timed out: " + source);
  };
  const checks = [];
  const check = async (name, source) => {
    const detail = await js(source);
    const ok = detail === true || (detail !== null && typeof detail === "object" && detail.ok === true);
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };
  const emit = async (text) => {
    await js(`window.__cairnPushEvent(${JSON.stringify({ type: "assistant_delta", callId: "f1", text, session_id: "s2", workspace: "/tmp/demo-ws", ts: Date.now() })})`);
    await pause(90);
  };

  // 每拍的「不闪」采样器：词色基线用页面自身的令牌算，避免把主题值烤进脚本。
  const sample = `(() => {
    const words = [...document.querySelectorAll('.row.assistant .md-word')];
    const rows = [...document.querySelectorAll('.row.assistant')];
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    probe.style.color = 'hsl(var(--text-000))';
    const textBase = getComputedStyle(probe).color;
    probe.style.color = 'hsl(var(--accent-brand))';
    const brandBase = getComputedStyle(probe).color;
    probe.remove();
    // Chromium 把 hsl()/hsl() 的插值算成 oklab(...)，基线又是 color(srgb ...) ⇒ 不能按字符串取数值比。
    // 统一画到不透明黑底上读 sRGB 像素：中性墨 r≈g≈b，品牌橙 r 远大于 g/b ⇒ 用「色偏」判据，
    // 与颜色空间无关；并用两个令牌基线自证这把尺子确实分得开中性墨和原橙。
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const toRgb = (s) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = s; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const spread = (c) => Math.max(Math.abs(c[0] - c[1]), Math.abs(c[1] - c[2]), Math.abs(c[0] - c[2]));
    const textSpread = spread(toRgb(textBase));
    const brandSpread = spread(toRgb(brandBase));
    const methodOk = textSpread <= 12 && brandSpread >= 40;
    const badOpacity = [];
    const badColor = [];
    const animNames = new Set();
    for (const w of words) {
      const cs = getComputedStyle(w);
      if (cs.opacity !== '1') badOpacity.push({ text: w.textContent, opacity: cs.opacity });
      animNames.add(cs.animationName);
      if (spread(toRgb(cs.color)) > 12) badColor.push({ text: w.textContent, color: cs.color });
    }
    const rowOpacity = rows.map((r) => getComputedStyle(r).opacity);
    return {
      ok: methodOk && words.length > 0 && badOpacity.length === 0 && badColor.length === 0
        && [...animNames].every((a) => a === 'md-word-arrive'),
      words: words.length, badOpacity, badColor,
      animNames: [...animNames], textBase, brandBase, textSpread, brandSpread, methodOk, rowOpacity,
      firstText: words[0]?.textContent ?? null,
    };
  })()`;

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await waitFor(`!!document.querySelector('.composer-card textarea') && !!document.querySelector('.session')`);
  await js(`(() => {
    const el = document.documentElement;
    el.dataset.theme = ${JSON.stringify(THEME)};
    el.dataset.mode = ${JSON.stringify(THEME)};
    document.body.toggleAttribute("data-ds-dark-theme", ${JSON.stringify(THEME)} === "dark");
    return true;
  })()`);
  await pause(250);
  {
    const img = await win.webContents.capturePage();
    const { width: W, height: H } = img.getSize();
    const raw = img.toBitmap();
    const px = (fx, fy) => { const i = (Math.round(H * fy) * W + Math.round(W * fx)) * 4; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const lum = (c) => (c[0] + c[1] + c[2]) / 3;
    const canvas = lum(px(0.72, 0.5)), side = lum(px(0.13, 0.5));
    const dark = THEME === "dark";
    if (dark ? !(canvas < 96 && side < 96) : (canvas < 96 || side < 96)) {
      throw new Error(`主题没落位：要 ${THEME}，canvas=${canvas} side=${side}`);
    }
    console.log(`[flicker-smoke] 主题像素自证 ${THEME}: canvas=${canvas} side=${side}`);
  }

  // 发起一轮（画廊桩把 run 挂住 ⇒ 流式态立得住）。
  await js(`(() => { const el = document.querySelector('.composer-card textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '复现输出闪烁'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await pause(30);
  await js(`document.querySelector('.composer-card textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
  await pause(500);
  // 第 1046 页：等待占位行的入场动画在首个 delta 之前量（之后整行会卸载）。
  await check("第 1046 页 · 等待占位行有 Claude 同档入场动画（computed）", `(() => {
    const el = document.querySelector('.row.assistant.assistant-waiting');
    if (!el) return { ok: false, reason: 'no waiting row' };
    const cs = getComputedStyle(el);
    return { ok: cs.animationName === 'cairn-placeholder-reveal' && cs.animationDuration === '0.15s' && cs.animationFillMode === 'both',
      name: cs.animationName, duration: cs.animationDuration, fill: cs.animationFillMode };
  })()`);

  // 真实 delta 粒度逐词推：故意含换行 / 列表 / 加粗 ⇒ 反复触发「正在写的那一块」易主（旧病灶）。
  const tokens = "这是一个 **重要的** 结论 ： 我们 需要 核对 每一项 配置 。\n\n- 第一项 检查 接口\n- 第二项 核对 默认值\n\n随后 再看 代码块 与 表格 是否 稳定 。".split(" ");
  const samples = [];
  for (let i = 0; i < tokens.length; i++) {
    await emit(tokens[i] + " ");
    const s = await js(sample);
    samples.push({ i, tok: tokens[i], ...s });
    if (!s.ok) console.log(`FAIL 第 ${i} 拍 ${JSON.stringify(s)}`);
    if (i === 6 || i === 12 || i === 18) {
      const img = await win.webContents.capturePage();
      writeFileSync(join(out, `stream-${String(i).padStart(2, "0")}-${THEME}.png`), img.toPNG());
    }
  }
  await check(`逐词流式全程不闪（${String(tokens.length)} 拍，含 3 次块结构易主）`, `(() => {
    const s = ${JSON.stringify(samples)};
    const bad = s.filter((x) => !x.ok);
    return { ok: s.length === ${String(tokens.length)} && bad.length === 0 && s.every((x) => x.words > 0),
      frames: s.length, badFrames: bad.map((x) => x.i), wordRange: [Math.min(...s.map((x) => x.words)), Math.max(...s.map((x) => x.words))],
      animNames: [...new Set(s.flatMap((x) => x.animNames))] };
  })()`);
  await check("已输出的首词不透明度不回退（旧病灶：animTime 重置到 83ms 重播）", `(() => {
    const s = ${JSON.stringify(samples)};
    const dips = s.filter((x) => x.badOpacity.length > 0);
    return { ok: dips.length === 0, dips: dips.map((x) => x.i), firstTexts: [...new Set(s.map((x) => x.firstText))].slice(0, 6) };
  })()`);
  await check("词色恒中性墨，不落品牌橙（canvas 色偏尺 + 双令牌基线自证）", `(() => {
    const s = ${JSON.stringify(samples)};
    const bad = s.filter((x) => x.badColor.length > 0 || x.methodOk !== true);
    return { ok: bad.length === 0, badFrames: bad.map((x) => x.i),
      textSpread: s[0]?.textSpread, brandSpread: s[0]?.brandSpread, methodOk: s[0]?.methodOk,
      textBase: s[0]?.textBase, brandBase: s[0]?.brandBase };
  })()`);
  await check("助手行只在首绘入场一次（row-in）；流式稳定后每行 opacity 恒 1", `(() => {
    const s = ${JSON.stringify(samples)};
    // 头两拍允许 row-in 的一次性 0→1（--t-fast；亮主题实测要两拍才落定）。
    // 之后任何一拍再出现非 1，就是整行明灭 ⇒ 判红。
    const rest = s.slice(2);
    return { ok: rest.every((x) => x.rowOpacity.every((o) => o === '1')),
      firstFrames: s.slice(0, 2).map((x) => x.rowOpacity), laterFrames: [...new Set(rest.flatMap((x) => x.rowOpacity))] };
  })()`);

  // 收束：终稿落定后历史正文不该还挂着逐词到达的 span（判卷②的 DOM 纪律）。
  await js(`window.__cairnPushEvent(${JSON.stringify({ type: "assistant_message", content: "收束", session_id: "s2", workspace: "/tmp/demo-ws", ts: Date.now() })})`);
  await pause(200);
  await js(`window.__cairnReleaseRun?.()`);
  await pause(300);
  await check("收束后历史正文不多包 md-word 节点", `(() => {
    const html = document.querySelector('.reading')?.innerHTML ?? '';
    return { ok: !html.includes('class="md-word"'), mdWord: (html.match(/class="md-word"/g) || []).length };
  })()`);

  const pageErrors = await js(`window.__galleryErrors ?? []`).catch(() => []);
  writeFileSync(join(out, "checks.json"), JSON.stringify({ theme: THEME, checks, consoleErrors: errors, pageErrors, samples }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`[flicker-smoke] ${THEME}: ${checks.length - failed.length}/${checks.length} PASS，console ${errors.length} 条，产物 ${out}`);
  clearTimeout(watchdog);
  app.exit(failed.length > 0 || errors.length > 0 ? 1 : 0);
}

main().catch((err) => { console.error("[flicker-smoke]", err); console.error("[flicker-smoke] renderer errors:", JSON.stringify(errors.slice(0, 8))); app.exit(1); });
