// 思考/工具流式面真机冒烟（2026-11-08 第 1042 页，zcode 3.17.2 对标批）：
// 离屏 Electron + 画廊桩（不跑真模型），steer 夹具挂住 run ⇒ 流式态立得住。
// 覆盖：① 折叠态 ticker 实时给「正在想的最后一行」（溢出跟尾+渐隐）；② 展开体限高 240px
// 内部滚动 + 自动跟尾（上滚即停、回底恢复）；③ 运行中可折叠（互斥锁已下架）；
// ④ 思考中标题/运行中工具摘要/组标题的中性流光（computed animationName 自证）；
// ⑤ 短纯文本结果轻卡片（p.tool-output-plain），多行仍 pre；⑥ 减弱动效停动并还原 flat 墨色。
// 用法：cd apps/desktop && electron scripts/thinking-live-smoke.cjs [outDir]（THEME=light|dark，默认 dark）
const electron = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (electron === null || typeof electron !== "object" || electron.app === undefined) {
  console.error("[think-smoke] 需要真 Electron：env -u ELECTRON_RUN_AS_NODE npx electron scripts/thinking-live-smoke.cjs");
  process.exit(2);
}
const { app, BrowserWindow, nativeTheme } = electron;
const { mkdtempSync, readFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const THEME = process.env.THEME === "light" ? "light" : "dark";
const profile = mkdtempSync(join(tmpdir(), "cairn-think-smoke-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = THEME;
app.on("quit", () => scheduleProfileCleanup(profile));
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), `cairn-think-smoke-${THEME}-`)));
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const errors = [];

async function main() {
  await app.whenReady();
  const watchdog = setTimeout(() => { console.error("[think-smoke] 超时 120s 自退"); app.exit(1); }, 120_000);
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
  const shot = async (name) => {
    await pause(120);
    const img = await win.webContents.capturePage();
    writeFileSync(join(out, name), img.toPNG());
  };
  /** 上缘 16px 条带的平均亮度（0-255）：直接读离屏绘制结果，不看 computed 样式。
   *  离屏窗口 deviceScaleFactor=1，CSS 像素与位图像素同坐标。 */
  const topBandLum = async () => {
    const rect = await js(`(() => {
      const el = document.querySelector('.row.think[data-running="true"] .think-body-inner');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    })()`);
    const img = await win.webContents.capturePage();
    const W = img.getSize().width;
    const raw = img.toBitmap();
    let sum = 0; let n = 0;
    for (let y = rect.y; y < rect.y + 16; y++) {
      for (let x = rect.x + 12; x < rect.x + rect.w - 12; x++) {
        const i = (y * W + x) * 4;
        sum += (raw[i] + raw[i + 1] + raw[i + 2]) / 3;
        n++;
      }
    }
    return { lum: sum / n, rect };
  };
  const emit = async (event) => {
    await js(`window.__cairnPushEvent(${JSON.stringify({ ...event, session_id: "s2", workspace: "/tmp/demo-ws", ts: Date.now() })})`);
    await pause(60);
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await waitFor(`!!document.querySelector('.composer-card textarea') && !!document.querySelector('.session')`);
  // 主题三把键一起落（第 884 页口径），再按像素自证——防「亮色趟拍成暗色」的工具假象。
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
    console.log(`[think-smoke] 主题像素自证 ${THEME}: canvas=${canvas} side=${side}`);
  }

  // 发起一轮（run 被 steer 夹具挂住 ⇒ 流式态立得住）。
  await js(`(() => { const el = document.querySelector('.composer-card textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '检查思考与工具的流式面'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await pause(30);
  await js(`document.querySelector('.composer-card textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
  await waitFor(`window.__cairnRuns().length === 1 && document.querySelector('.gen-bar')?.dataset.running === 'true'`);

  // 思考正文：多行 + 超长行（ticker 要溢出、展开体要超过 240px）。
  const long = "核对 settings 的落盘口径与默认表的对齐关系，分段控件的选中态必须有真实默认值兜底。".repeat(3);
  await emit({ type: "thinking_delta", callId: "lt", text: "先查 RunOverrides 的现有形态，再决定是落盘还是运行面取值。\n" });
  await emit({ type: "thinking_delta", callId: "lt", text: long + "\n" });
  for (let i = 0; i < 12; i++) {
    await emit({ type: "thinking_delta", callId: "lt", text: `第 ${i + 3} 行：` + "再把投影面与判卷夹具逐条核对，构造语料要能分辨语义差。".repeat(2) + "\n" });
  }
  await emit({ type: "thinking_delta", callId: "lt", text: "最后一行： ticker 必须实时显示这一句，而不是开头的陈旧摘要。" + "这一行要足够长，才能把 ticker 的宽度撑溢出。".repeat(4) });

  await check("运行中折叠态：ticker 在场、无锁、显示最后一行", `(() => {
    const row = document.querySelector('.row.think[data-running="true"]');
    if (!row) return { ok: false, reason: 'no live think row' };
    const toggle = row.querySelector('.think-toggle');
    const ticker = row.querySelector('.think-ticker');
    return { ok: toggle?.getAttribute('aria-expanded') === 'false' && !toggle?.hasAttribute('aria-disabled')
      && !!ticker && ticker.textContent.includes('ticker 必须实时显示这一句'),
      expanded: toggle?.getAttribute('aria-expanded'), disabled: toggle?.hasAttribute('aria-disabled'),
      tickerText: ticker?.textContent?.slice(-40) ?? null };
  })()`);
  await check("ticker 溢出：跟到行尾 + 两端渐隐 mask", `(() => {
    const t = document.querySelector('.row.think[data-running="true"] .think-ticker');
    if (!t) return { ok: false };
    const cs = getComputedStyle(t);
    return { ok: t.dataset.overflow === 'true' && t.scrollLeft > 0 && cs.maskImage.includes('linear-gradient'),
      overflow: t.dataset.overflow, scrollLeft: t.scrollLeft, scrollWidth: t.scrollWidth, client: t.clientWidth, mask: cs.maskImage.slice(0, 60) };
  })()`);
  await check("「思考中」标题流光真的在跑（computed animationName）", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-label');
    if (!el) return { ok: false };
    const cs = getComputedStyle(el);
    return { ok: cs.animationName === 'live-shimmer-flow' && cs.backgroundImage.includes('linear-gradient'),
      animation: cs.animationName, duration: cs.animationDuration, bg: cs.backgroundImage.slice(0, 50) };
  })()`);
  await shot(`01-live-ticker-${THEME}.png`);

  // 展开：限高 + 自动跟尾。
  await js(`document.querySelector('.row.think[data-running="true"] .think-toggle').click()`);
  await pause(300);
  await check("展开体限高 240px 且内容超出（内部滚动，不再顶高阅读面）", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-text');
    if (!el) return { ok: false };
    return { ok: el.clientHeight <= 240 && el.scrollHeight > el.clientHeight + 40,
      client: el.clientHeight, scroll: el.scrollHeight };
  })()`);
  await check("展开即跟尾（贴底）", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-text');
    if (!el) return { ok: false };
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    return { ok: gap <= 40, gap, scrollTop: el.scrollTop };
  })()`);
  await check("第 1044 页 · 贴底时只淡上缘（末行完整可读），mask 在计算样式里", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-body-inner');
    if (!el) return { ok: false };
    const cs = getComputedStyle(el);
    const topVar = cs.getPropertyValue('--think-fade-top').trim();
    const bottomVar = cs.getPropertyValue('--think-fade-bottom').trim();
    return { ok: el.dataset.fadeTop === 'true' && el.dataset.fadeBottom === 'false'
      && cs.maskImage.includes('linear-gradient') && topVar === '16px' && bottomVar === '0px',
      fadeTop: el.dataset.fadeTop, fadeBottom: el.dataset.fadeBottom, topVar, bottomVar,
      mask: cs.maskImage.slice(0, 100) };
  })()`);
  // 像素对照：同一帧开 / 关 mask 各拍一张并直接量条带亮度，证明渐隐真的落到绘制结果上。
  const lumOn = await topBandLum();
  await shot(`05-edge-mask-on-${THEME}.png`);
  await js(`(() => { const el = document.querySelector('.row.think[data-running="true"] .think-body-inner'); el.style.maskImage = 'none'; return true; })()`);
  await pause(100);
  await shot(`06-edge-mask-off-${THEME}.png`);
  const lumOff = await topBandLum();
  await js(`(() => { const el = document.querySelector('.row.think[data-running="true"] .think-body-inner'); el.style.removeProperty('mask-image'); return true; })()`);
  await check("第 1044 页 · 像素自证：上缘 16px 真的融进画布（开关 mask 的绘制差）", `(() => {
    const diff = ${Number((lumOff.lum - lumOn.lum).toFixed(2))};
    return { ok: Math.abs(diff) > 2, diff, on: ${Number(lumOn.lum.toFixed(2))}, off: ${Number(lumOff.lum.toFixed(2))},
      direction: diff > 0 ? '暗画布：on 更暗' : '亮画布：on 更亮', band: ${JSON.stringify(lumOn.rect)} };
  })()`);
  await pause(60);
  await emit({ type: "thinking_delta", callId: "lt", text: "\n追加一行：自动跟尾必须把这一行带进视口。" });
  await check("流式追加仍贴底（自动跟尾）", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-text');
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    return { ok: gap <= 40, gap };
  })()`);
  await shot(`02-expanded-capped-${THEME}.png`);

  // 用户上滚 ⇒ 停跟；回底 ⇒ 恢复。
  await js(`(() => { const el = document.querySelector('.row.think[data-running="true"] .think-text'); el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); return true; })()`);
  await pause(40);
  await emit({ type: "thinking_delta", callId: "lt", text: "\n用户上滚期间追加：不该把他拽回底部。" });
  await check("用户上滚后追加不拽回（停跟）", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-text');
    return { ok: el.scrollTop <= 40, scrollTop: el.scrollTop };
  })()`);
  await check("第 1044 页 · 滚到顶时只淡下缘（首行完整可读）", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-body-inner');
    const sc = document.querySelector('.row.think[data-running="true"] .think-text');
    if (!el || !sc) return { ok: false };
    const cs = getComputedStyle(el);
    return { ok: el.dataset.fadeTop === 'false' && el.dataset.fadeBottom === 'true'
      && cs.getPropertyValue('--think-fade-top').trim() === '0px'
      && cs.getPropertyValue('--think-fade-bottom').trim() === '16px',
      fadeTop: el.dataset.fadeTop, fadeBottom: el.dataset.fadeBottom, scrollTop: sc.scrollTop };
  })()`);
  await js(`(() => { const el = document.querySelector('.row.think[data-running="true"] .think-text'); el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2); el.dispatchEvent(new Event('scroll')); return true; })()`);
  await pause(40);
  await check("第 1044 页 · 中间位置上下缘同时渐隐", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-body-inner');
    const sc = document.querySelector('.row.think[data-running="true"] .think-text');
    if (!el || !sc) return { ok: false };
    return { ok: el.dataset.fadeTop === 'true' && el.dataset.fadeBottom === 'true',
      fadeTop: el.dataset.fadeTop, fadeBottom: el.dataset.fadeBottom, scrollTop: sc.scrollTop };
  })()`);
  await js(`(() => { const el = document.querySelector('.row.think[data-running="true"] .think-text'); el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); return true; })()`);
  await pause(40);
  await emit({ type: "thinking_delta", callId: "lt", text: "\n回底之后追加：恢复跟尾。" });
  await check("回底后恢复跟尾", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-text');
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    return { ok: gap <= 40, gap };
  })()`);

  // 运行中折叠回去 ⇒ ticker 回来（互斥锁已下架）。
  await js(`document.querySelector('.row.think[data-running="true"] .think-toggle').click()`);
  await pause(250);
  await check("运行中可折叠：ticker 带最新一行回来", `(() => {
    const row = document.querySelector('.row.think[data-running="true"]');
    const toggle = row?.querySelector('.think-toggle');
    const ticker = row?.querySelector('.think-ticker');
    return { ok: toggle?.getAttribute('aria-expanded') === 'false' && !!ticker && ticker.textContent.includes('恢复跟尾'),
      text: ticker?.textContent?.slice(-30) ?? null };
  })()`);

  // 减弱动效：停动 + 还原 flat 墨色（不许留透明字）。
  await js(`document.documentElement.setAttribute('data-reduce-motion', 'true')`);
  await pause(60);
  await check("app 内减弱：思考标题停动并还原 flat 墨色", `(() => {
    const el = document.querySelector('.row.think[data-running="true"] .think-label');
    const cs = getComputedStyle(el);
    return { ok: cs.animationName === 'none' && cs.backgroundImage === 'none' && cs.color !== 'rgba(0, 0, 0, 0)',
      animation: cs.animationName, color: cs.color };
  })()`);
  await js(`document.documentElement.removeAttribute('data-reduce-motion')`);

  // 工具：pending 流光 + 组标题 data-pending。
  await emit({ type: "tool_call", id: "tl1", name: "run_shell", args: { command: "pnpm test" } });
  await check("运行中工具摘要流光 + 组标题 data-pending", `(() => {
    const tsum = document.querySelector('.row.tool[data-state="pending"] .tsum');
    const toggle = document.querySelector('.tool-group-toggle[data-pending="true"]');
    const label = toggle?.querySelector('.tool-group-label');
    const cs = tsum ? getComputedStyle(tsum) : null;
    const ls = label ? getComputedStyle(label) : null;
    return { ok: cs?.animationName === 'live-shimmer-flow' && !!toggle && ls?.animationName === 'live-shimmer-flow',
      tsum: cs?.animationName ?? null, label: ls?.animationName ?? null };
  })()`);
  await shot(`03-tool-pending-${THEME}.png`);

  // 短结果 ⇒ 轻卡片；多行结果 ⇒ pre。
  await emit({ type: "tool_result", callId: "tl1", ok: true, output: "Documentation loaded." });
  await emit({ type: "tool_call", id: "tl2", name: "list_dir", args: { path: "apps/desktop" } });
  await emit({ type: "tool_result", callId: "tl2", ok: true, output: "src\ntests\nscripts" });
  await js(`document.querySelector('.tool-group-toggle')?.click()`);
  await pause(120);
  await js(`[...document.querySelectorAll('.row.tool .tool-head')].forEach((b) => b.click())`);
  await pause(200);
  await check("短单行结果穿轻卡片（p.tool-output-plain），多行仍 pre", `(() => {
    const plain = document.querySelector('p.tool-output-plain');
    const pres = [...document.querySelectorAll('.tool-output pre')].map((p) => p.textContent);
    return { ok: plain?.textContent === 'Documentation loaded.' && pres.some((t) => t.includes('src\\ntests\\nscripts')) && !pres.some((t) => t.includes('Documentation loaded.')),
      plain: plain?.textContent ?? null, pres: pres.map((t) => t.slice(0, 30)) };
  })()`);
  await shot(`04-plain-output-${THEME}.png`);

  // 收束：终稿 + 放行 run ⇒ 思考行落定，ticker 退场。
  await emit({ type: "assistant_message", content: "检查完成。" });
  await js(`window.__cairnReleaseRun()`);
  await pause(300);
  await check("收束后：无运行中思考行、无 ticker（过程带折叠接手）", `(() => {
    return { ok: !document.querySelector('.row.think[data-running="true"]') && !document.querySelector('.think-ticker'),
      processFold: !!document.querySelector('.process-fold') };
  })()`);

  // 折叠态摘要不许被「复制」钮压住（第 1042 页截图缺陷：右留位 34px < 复制钮 53px+2px ⇒ 重叠 21px）。
  // 展开过程带露出落定的思考行，量摘要右缘与复制钮左缘——摘要必须停在钮左侧之外。
  await js(`document.querySelector('.process-fold-toggle')?.click()`);
  await pause(250);
  await check("折叠态摘要右缘不压复制钮（几何不重叠）", `(() => {
    const row = document.querySelector('.row.think');
    const preview = row?.querySelector('.think-preview');
    const actions = row?.querySelector('.thinking-actions');
    if (!preview || !actions) return { ok: false, reason: 'no preview/actions' };
    const pr = preview.getBoundingClientRect();
    const ar = actions.getBoundingClientRect();
    return { ok: pr.right <= ar.left, previewRight: pr.right, actionsLeft: ar.left, gap: ar.left - pr.right };
  })()`);

  const pageErrors = await js(`window.__galleryErrors ?? []`).catch(() => []);
  writeFileSync(join(out, "checks.json"), JSON.stringify({ theme: THEME, checks, consoleErrors: errors, pageErrors }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`[think-smoke] ${THEME}: ${checks.length - failed.length}/${checks.length} PASS，console ${errors.length} 条，产物 ${out}`);
  clearTimeout(watchdog);
  app.exit(failed.length > 0 || errors.length > 0 ? 1 : 0);
}

main().catch((err) => { console.error("[think-smoke]", err); console.error("[think-smoke] renderer errors:", JSON.stringify(errors.slice(0, 8))); app.exit(1); });