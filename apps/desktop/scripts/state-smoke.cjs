// 用真实 renderer + 可控 AgentApi 验证消息标记的延迟、失败与跨会话归属；不运行模型，不使用或清空产品用户数据。
// 先 pnpm --filter cairn-desktop build，再 pnpm --filter cairn-desktop exec electron scripts/state-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-state-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-state-"));
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-hardening-fixture"],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = () => new Promise((r) => setTimeout(r, 350));
  const shot = async (name) => { await pause(); writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG()); };
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause();
  const row = (event, label) => `[data-event-id="${event}"] button[aria-label="${label}"]`;
  const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const mark = (event, label) => js(`document.querySelector(${JSON.stringify(row(event, label))})?.getAttribute('aria-pressed') === 'true'`);
  const settle = async (kind, index, ok) => { await js(`window.__cairnFixture.settle(${JSON.stringify(kind)}, ${index}, ${ok})`); await pause(); };
  await click('.session'); await pause();
  await click(row(2, '踩这条输出')); await pause();
  check('提交中的同一条反馈禁止重复发送', await js(`document.querySelector(${JSON.stringify(row(2,'取消点踩'))}).disabled`));
  await click(row(2, '取消点踩')); await pause();
  check('等待中的重复点击不发送第二个反馈请求', await js(`window.__cairnFixture.count('feedback') === 1`));
  check('请求未完成时操作条保持可见，移开鼠标也能看到保存状态', await js(`getComputedStyle(document.querySelector(${JSON.stringify(row(2,'取消点踩'))}).closest('.row-actions')).opacity === '1'`));
  await shot('01-feedback-pending');
  await click(row(3, '赞这条输出')); await pause();
  await settle('feedback', 1, true); await settle('feedback', 0, false);
  check('反馈失败只回滚本条，不清空其他已成功标记', await mark(3, '取消点赞'));
  await click(row(2, '取消置顶这条输出')); await pause();
  check('提交中的置顶按钮同样有等待状态', await js(`document.querySelector(${JSON.stringify(row(2,'置顶这条输出'))}).disabled`));
  await click(row(3, '置顶这条输出')); await pause();
  await settle('pin', 1, true); await settle('pin', 0, false);
  check('置顶失败只回滚本条，不清空其他已成功标记', await mark(3, '取消置顶这条输出'));
  await click(row(2, '踩这条输出')); await pause();
  await click(row(2, '取消置顶这条输出')); await pause();
  await js(`document.querySelectorAll('.session')[1].click()`); await pause();
  check('另一会话先展示自己的反馈与置顶', await mark(2, '取消点踩') && await mark(3, '取消置顶这条输出'));
  await settle('feedback', 2, false); await settle('pin', 2, false);
  check('旧会话迟到失败不覆盖当前会话的标记', await mark(2, '取消点踩') && await mark(3, '取消置顶这条输出'));
  check('旧会话的提交错误不显示到当前会话', await js(`!document.querySelector('.error-strip')?.textContent.includes('测试用延迟失败')`));
  await click(row(2, '取消点踩')); await pause();
  await js(`document.querySelectorAll('.session')[0].click()`); await pause();
  await js(`document.querySelectorAll('.session')[1].click()`); await pause();
  await settle('feedback', 3, false);
  check('切走再切回同一会话，旧请求也不能回滚新加载的状态', await mark(2, '取消点踩'));
  await shot('02-independent-session-marks');
  check("渲染过程无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("state-smoke: 超时"); app.exit(1); }, 30_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
