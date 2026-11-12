// 设置分区渲染错误的真实 renderer 冒烟（2026-10-25）：
//   畸形 search settings 快照会让 NetworkSection 在渲染期抛错；旧实现把 React 根卸载成
//   启动占位（整窗白屏）。这里验：错误被分区边界接住、左导航仍在、切到好分区自动恢复。
// 先 pnpm --filter cairn-desktop build，再 electron scripts/error-boundary-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-boundary-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-boundary-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({
    name: s[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)),
  }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-crash-network-fixture",
      ],
    },
  });
  await win.webContents.session.clearStorageData();
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 1200));
  const js = (source) => win.webContents.executeJavaScript(source);
  const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  const shot = async (name) => { await wait(150); writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG()); };

  await js(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "Comma", key: ",", metaKey: true, bubbles: true }))`);
  await wait(700);
  check("设置页正常打开（左导航在场）", await js(`!!document.querySelector('.sp-nav') && [...document.querySelectorAll('.sp-nav-item')].some(e => e.textContent.includes('联网搜索'))`));
  await js(`[...document.querySelectorAll('.sp-nav-item')].find(e => e.textContent.includes('联网搜索')).click()`);
  await wait(700);
  const crashed = await js(`(() => {
    const fallback = document.querySelector('.sp-body .render-error.inline');
    const root = document.getElementById('root');
    const boot = document.querySelector('#boot');
    const bootStyle = boot ? getComputedStyle(boot) : null;
    return {
      fallback: !!fallback,
      role: fallback?.getAttribute('role') ?? null,
      text: fallback?.textContent ?? '',
      nav: document.querySelectorAll('.sp-nav-item').length,
      networkForm: !!document.querySelector('.network-settings'),
      // 启动占位节点可能留在 DOM 里等淡出；判「有没有盖在界面上」而不是判节点不存在。
      bootVisible: !!(boot && bootStyle && bootStyle.visibility !== 'hidden' && bootStyle.opacity !== '0' && boot.getBoundingClientRect().height > 0),
      rootChars: root?.innerHTML.length ?? -1,
    };
  })()`);
  check("分区抛错被接住：显示内联兜底，整窗不白屏", crashed.fallback && crashed.role === "alert" && crashed.text.includes("这一块加载失败") && crashed.rootChars > 100 && !crashed.bootVisible, crashed);
  check("左导航仍在、坏的联网表单没有半边渲染", crashed.nav >= 10 && crashed.networkForm === false, crashed);
  console.log("[boundary] retry button", await js(`(() => {
    const b = document.querySelector('.re-actions .mini-btn');
    if (!b) return "missing";
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return JSON.stringify({ text: b.textContent, rect: { w: Math.round(r.width), h: Math.round(r.height) }, scrollW: b.scrollWidth, clientW: b.clientWidth, display: cs.display, width: cs.width, padding: cs.padding, fs: cs.fontSize, color: cs.color, bg: cs.backgroundColor, whiteSpace: cs.whiteSpace });
  })()`));
  await shot("01-network-boundary");

  await js(`[...document.querySelectorAll('.sp-nav-item')].find(e => e.textContent.includes('通用')).click()`);
  await wait(600);
  const recovered = await js(`(() => {
    const page = document.querySelector('.sp-body .ss-page');
    return { title: page?.querySelector('.ss-title')?.textContent ?? null, fallback: !!document.querySelector('.sp-body .render-error'), nav: document.querySelectorAll('.sp-nav-item').length };
  })()`);
  check("切到好分区自动恢复（无需先点重试）", recovered.title === "通用" && recovered.fallback === false && recovered.nav >= 10, recovered);
  await shot("02-recovered-general");

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error("error-boundary-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
