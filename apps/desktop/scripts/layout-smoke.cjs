// 用真实 renderer + 合成 AgentApi 验证布局；不运行模型，不使用或清空产品用户数据。
// 先 pnpm --filter cairn-desktop build，再 pnpm --filter cairn-desktop exec electron scripts/layout-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-layout-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-layout-"));
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = () => new Promise((r) => setTimeout(r, 350));
  const shot = async (name) => { await pause(); writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG()); };
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause();
  await shot("01-home");
  const home = await js(`(() => {
    const h = document.querySelector('.empty-greet').getBoundingClientRect();
    const c = document.querySelector('.composer-card').getBoundingClientRect();
    return { headingLeft: h.left, composerLeft: c.left, footer: document.querySelector('.avatar').textContent,
      canvas: getComputedStyle(document.body).backgroundColor,
      radius: getComputedStyle(document.querySelector('.composer-card')).borderRadius,
      upstream: document.body.hasAttribute('data-dsh-claude-style') };
  })()`);
  check("首页标题、项目与输入区共用阅读起点", Math.abs(home.headingLeft - home.composerLeft) <= 24, home);
  check("设置入口有可见文字，未伪装成用户头像", home.footer.includes("设置"), home.footer);
  check("已加载上游 Claude 主题与输入卡样式", home.upstream && home.canvas === "rgb(252, 252, 251)" && home.radius === "18px", home);
  await js("document.querySelector('.session').click()");
  await shot("02-session");
  const row = await js(`(() => {
    const r = document.querySelector('.session').getBoundingClientRect();
    const t = document.querySelector('.s-title').getBoundingClientRect();
    return { rowWidth: r.width, titleWidth: t.width };
  })()`);
  check("侧栏任务名获得至少六成行宽", row.titleWidth >= row.rowWidth * .6, row);
  await win.setContentSize(880, 700);
  await shot("03-narrow");
  const narrow = await js(`(() => {
    const c = document.querySelector('.composer-card').getBoundingClientRect();
    return { left: c.left, right: c.right, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
  check("窄窗输入框完整可见，页面无横向溢出", !narrow.overflow && narrow.left >= 0 && narrow.right <= narrow.viewport, narrow);
  nativeTheme.themeSource = "dark";
  await shot("04-dark");
  const dark = await js(`({ canvas: getComputedStyle(document.body).backgroundColor, link: getComputedStyle(document.querySelector('.md-body a')).color })`);
  check("暗色主题与 Markdown 链接使用上游配色", dark.canvas === "rgb(20, 20, 19)" && dark.link === "rgb(138, 180, 248)", dark);
  await win.setContentSize(1440, 900);
  nativeTheme.themeSource = "light";
  await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", code: "Comma", metaKey: true, bubbles: true }))');
  await pause();
  await js(`[...document.querySelectorAll('.sp-nav-item')].find(b => b.textContent.includes('模型与 Provider'))?.click()`);
  await shot("05-settings");
  const settings = await js(`({ open: !!document.querySelector('.sp-page'), title: document.querySelector('.tb-title-slot').textContent, tools: document.querySelector('.tb-right').textContent, taskButton: !!document.querySelector('.tb-right button') })`);
  check("设置页顶栏显示当前页面并收起任务操作", settings.open && settings.title === "设置" && !settings.taskButton, settings);
  check("渲染过程无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  checks.forEach((c) => console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name} ${JSON.stringify(c.detail)}`));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("layout-smoke: 超时"); app.exit(1); }, 30_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
