// 跨工作区恢复上次会话（真实 renderer + 合成 AgentApi）：
// 上次会话属于另一个已注册项目时，启动必须恢复它，并把工作区上下文切到那一侧。
// 先 pnpm --filter cairn-desktop build，再 pnpm --filter cairn-desktop exec electron scripts/cross-workspace-restore.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-cross-ws-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-cross-ws-"));
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
        "--cairn-interaction-fixture",
        "--cairn-cross-workspace-fixture",
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  const js = (source) => win.webContents.executeJavaScript(source).catch((err) => {
    console.error("执行失败:", source, "\nrenderer errors:", errors, "\n", err);
    throw err;
  });
  const pause = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };
  const waitFor = async (source, timeoutMs = 4000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await js(source).catch(() => false)) return true;
      await pause();
    }
    return false;
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(400);
  check("正常启动清单里有两个项目的会话", await js(`(() => { return [...document.querySelectorAll('.session')].some(el => el.textContent.includes('跨工作区')); })()`));
  // 重启场景：只留 lastSession key，指向另一个项目的会话，然后重载。
  await js(`(() => { localStorage.setItem('cairn.lastSession.v1', JSON.stringify({ id: 's-other', workspace: '/tmp/demo-ws-other' })); return true; })()`);
  await win.reload();
  const restored = await waitFor(`(() => { return !!document.querySelector('.session[data-active="true"]')?.textContent.includes('跨工作区'); })()`);
  await pause(300);
  const state = await js(`(() => {
    const active = document.querySelector('.session[data-active="true"]');
    const group = document.querySelector('.group[data-active="true"] .group-head');
    const calls = window.__cairnCrossWorkspace?.calls();
    return {
      active: active?.textContent ?? null,
      group: group?.getAttribute('title') ?? null,
      body: document.querySelector('.stream, .transcript, .session-body')?.innerText ?? document.body.innerText,
      pref: (() => { try { return JSON.parse(localStorage.getItem('cairn.lastSession.v1')); } catch { return null; } })(),
      calls,
      keyOpen: calls?.open?.some((c) => c.id === 's-other' && c.workspace === '/tmp/demo-ws-other') ?? false,
      keyWorkspace: calls?.workspace?.includes('/tmp/demo-ws-other') ?? false,
    };
  })()`);
  check("启动恢复跨工作区会话（侧栏行 active 且是另一项目）", restored && state.active?.includes("跨工作区"), state);
  check("活动项目组切到会话归属的工作区", state.group === "/tmp/demo-ws-other", state.group);
  check("主区加载的是该会话正文", String(state.body).includes("跨工作区会话内容已恢复"), String(state.body).slice(0, 200));
  check("恢复走 openSession 且工作区上下文同步", state.keyOpen && state.keyWorkspace, state.calls);
  check("恢复成功后 lastSession key 仍带 id + workspace", state.pref?.id === "s-other" && state.pref?.workspace === "/tmp/demo-ws-other", state.pref);
  check("渲染过程无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`读数：${out}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("cross-workspace-restore: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
