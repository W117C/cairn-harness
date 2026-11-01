// 设置分区搜索的真实 renderer 冒烟（2026-10-30 · 第 814 页）：
// 重点不是「搜索框能打字」，而是第 805–813 页新加的维护动作能被口语词打到：
// 备份/迁移/许可证/偏好 ⇒ 关于与更新（其正文含偏好备份、许可证导入、诊断包）。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-search-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-search-smoke-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({ name: m[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") { errors.push(d.message); console.error("renderer:", d.message); } });
  const js = (s) => win.webContents.executeJavaScript(s);
  const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  async function waitFor(predicate, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return true; await pause(80); }
    throw new Error("Timeout: " + label);
  }
  const typeQuery = async (text) => {
    await js(`(() => { const el = document.querySelector('.sp-nav-search-input'); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await pause(200);
    return await js(`[...document.querySelectorAll('.sp-nav-item')].map((el) => el.textContent.trim())`);
  };
  const pointerOn = async (findExpr) => {
    const point = await js(`(() => { const el = ${findExpr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(300);
    return true;
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1200);
  await win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  await waitFor(() => js(`!!document.querySelector('.sp-nav-search-input')`), "settings search");
  check("设置搜索框在屏上", true, null);

  for (const [query, label] of [["备份", "备份"], ["迁移", "迁移"], ["许可证", "许可证"]]) {
    const items = await typeQuery(query);
    check(`「${label}」命中关于与更新且只剩它`, items.length === 1 && items[0].includes("关于与更新"), items);
  }
  check("真指针点关于与更新", await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.includes('关于与更新'))`), null);
  const bodyText = await js(`document.querySelector('.sp-body')?.innerText ?? ''`);
  check("正文能直接看到偏好备份 / 许可证导入 / 诊断包", bodyText.includes("偏好备份") && bodyText.includes("导入许可证") && bodyText.includes("导出诊断包"), bodyText.slice(0, 160));
  check("无关词不伪造命中", (await typeQuery("zzzz不存在")).length === 0, null);
  writeFileSync(join(out, "01-settings-search.png"), (await win.webContents.capturePage()).toPNG());
  // 第 823 页：关于页新加的「构建于 … · 签名 · 冒烟」在三个支持宽度都要可见且不溢出。
  const versionRow = await js(`(() => { const row = [...document.querySelectorAll('.ss-row')].find((r) => r.textContent.includes('构建于')); return row ? { text: row.innerText, width: row.getBoundingClientRect().width } : null; })()`);
  check("1440 版本行显示构建来源", versionRow !== null && versionRow.text.includes("ad-hoc") && versionRow.width > 0, versionRow);
  for (const width of [1120, 880]) {
    await win.setContentSize(width, 760); await pause(400);
    const state = await js(`(() => { const body = document.querySelector('.sp-body'); const row = [...document.querySelectorAll('.ss-row')].find((r) => r.textContent.includes('构建于')); return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, bodyOverflow: body ? body.scrollWidth > body.clientWidth : null, visible: row ? row.getBoundingClientRect().width > 0 : false, text: row?.innerText.slice(0, 48) ?? null }; })()`);
    check(`${width} 构建来源可见且无横向溢出`, state.overflow === false && state.bodyOverflow === false && state.visible, state);
    writeFileSync(join(out, `02-about-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[settings-search-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("settings-search-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
