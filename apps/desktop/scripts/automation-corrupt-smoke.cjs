// 自动化文件损坏的真实 renderer 冒烟（2026-10-30，第 785 页）。
//
// 缺陷形态：automations.json 坏了 ⇒ 调度器只 console.warn（桌面没有控制台）⇒
// 自动化页写着「还没有定时任务」，新建又被拒（写路径拒绝覆盖坏档）——用户无从知道原因。
// 本冒烟用画廊夹具复现坏档快照，真开自动化页，判三面：
//   1. 横幅在场且点名文件/原因/写路径会被拒；
//   2. 空态仍在（警告不是替代空态，是叠加说明）；
//   3. 无控制台错误。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/automation-corrupt-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-automation-corrupt-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });

const out = process.argv[2]
  ? resolve(process.argv[2])
  : mkdtempSync(join(tmpdir(), "cairn-automation-corrupt-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((member, index) => ({
    name: member[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(member.index, starts[index + 1]?.index ?? body.length)),
  }));

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-agent-os-fixture",
        "--cairn-schedule-corrupt-fixture",
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") { errors.push(details.message); console.error("renderer:", details.message); }
  });

  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: ok === true, detail });
    console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };
  async function waitFor(predicate, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return true; await pause(80); }
    throw new Error("Timeout: " + label);
  }
  const pointerOn = async (selector) => {
    const point = await js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(350);
    return true;
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await waitFor(() => js(`!!document.querySelector('[data-destination="automation"]')`), "app rail");

  check("真实指针点到「自动化」", await pointerOn('[data-destination="automation"]'), null);
  await waitFor(() => js(`!!document.querySelector('.destination-page[aria-label="自动化"] .page-frame-title')`), "automation page");
  await waitFor(() => js(`!!document.querySelector('.destination-page[aria-label="自动化"] .ss-banner.warn')`), "corrupt banner");

  const state = await js(`(() => {
    const page = document.querySelector('.destination-page[aria-label="自动化"]');
    const banner = page.querySelector('.ss-banner.warn');
    return {
      banner: banner?.innerText ?? '',
      empty: page.innerText.includes('还没有定时任务'),
      // 2026-11-04 业主截图形制：空态换成 hero 卡——创建入口是「创建定时任务」下拉
      // （旧「新建任务」工具行在该分支已不存在）。两条名字都认：恢复路径活的判据不变。
      createEnabled: [...page.querySelectorAll('button')].some((b) => (b.textContent.includes('新建任务') || b.textContent.includes('创建定时任务')) && !b.disabled),
    };
  })()`);
  check("横幅点名坏档文件与原因", state.banner.includes("调度任务文件损坏") && state.banner.includes("automations.json") && state.banner.includes("JSON 解析失败"), state.banner);
  check("横幅说清写路径会被拒（不是只报错）", state.banner.includes("新建、修改、删除任务都会被拒绝") && state.banner.includes("本次不覆盖"), state.banner);
  check("空态仍在：警告是叠加说明，不是替代空态", state.empty === true, state);
  check("「创建定时任务」入口仍可点：修好文件后靠一次成功写入清掉横幅（不是死路）", state.createEnabled === true, state);
  await pause(250);
  writeFileSync(join(out, "01-automation-corrupt.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[automation-corrupt-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error("automation-corrupt-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
