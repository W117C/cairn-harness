// 命令面板「切换权限档」的真实 renderer 冒烟（2026-10-30，第 784 页）。
//
// 第 782 页把循环的**顺序**收回到核心档位表（`nextPermissionMode`），但那一批的边界写明：
// 「命令面板点选这一动作未单独真机冒烟」。这里补上：真实 ⌘K → 输入 → ⏎ 四步走完一轮
// （2026-11-03 起选择面四档：只读/需要审批/智能审批/完全允许；引导并入智能审批），
// 判三面——
//   1. setSettings 的补丁序列（应答侧真值，不是看源码）；
//   2. 输入框旁权限 chip 的可见文案（用户看到的那一格）；
//   3. 提示条回执（动作有没有被确认给用户）。
// 分辨力：任何一档漏进循环（如旧文档里的第五档 guided）⇒ 步数或档名当场对不上。
//
// 前置：pnpm --filter cairn-desktop build
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron scripts/palette-perm-cycle-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-perm-cycle-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });

const out = process.argv[2]
  ? resolve(process.argv[2])
  : mkdtempSync(join(tmpdir(), "cairn-perm-cycle-"));
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
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") { errors.push(details.message); console.error("renderer:", details.message); }
  });

  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: ok === true, detail });
    console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };
  async function waitFor(predicate, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return true; await pause(60); }
    throw new Error("Timeout: " + label);
  }
  const pressKey = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await pause(140);
  };
  const chipText = () => js(`document.querySelector('.composer-card .mode-dot')?.closest('button')?.innerText?.trim() ?? null`);
  const noticeText = () => js(`document.querySelector('.notice-strip .msg')?.textContent ?? null`);
  const modeCalls = () => js(`window.__cairnSettingsCalls().filter((p) => typeof p.mode === 'string')`);

  /** 走一次真实用户路径：⌘K → 输入「权限」→ ⏎。返回面板是否真的被打开过。 */
  const confirmIfAsked = async () => {
    const asked = await js(`!!document.querySelector('.confirm-card .cc-title')`);
    if (!asked) return false;
    const confirmDom = await js(`(() => [...document.querySelectorAll('.confirm-card button')].map(b => { const r = b.getBoundingClientRect(); const c = getComputedStyle(b); return { text: b.textContent.trim(), cls: b.className, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: c.display, visibility: c.visibility, color: c.color, bg: c.backgroundColor, bgImage: c.backgroundImage }; }))()`);
    console.error("[perm-confirm-dom]", JSON.stringify(confirmDom));
    const dangerBtn = confirmDom.find((b) => String(b.cls).includes("danger"));
    check("危险档确认按钮有实底（不是白字白底）", dangerBtn !== undefined && dangerBtn.bg !== "rgba(0, 0, 0, 0)" && dangerBtn.bg !== "transparent", dangerBtn);
    const tokenProbe = await js(`(() => { const s=getComputedStyle(document.documentElement); return { danger:s.getPropertyValue('--color-danger'), role300:s.getPropertyValue('--role-danger-300'), fg:s.getPropertyValue('--fg-on-danger'), theme:document.documentElement.getAttribute('data-theme'), dsh:document.body.getAttribute('data-dsh-claude-style') }; })()`);
    console.error("[perm-token]", JSON.stringify(tokenProbe));
    writeFileSync(join(out, "03-perm-confirm.png"), (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.confirm-card .mini-btn.danger')?.click()`);
    await pause(340);
    return true;
  };

  const cycleViaPalette = async () => {
    await win.webContents.focus();
    await pressKey("K", ["meta"]);
    const opened = await waitFor(() => js(`!!document.querySelector('.cp-panel')`), "palette open");
    if (!opened) return false;
    win.webContents.insertText("权限");
    await pause(180);
    const target = await js(`document.querySelector('.cp-item[aria-selected="true"] .cp-label')?.textContent?.trim() ?? null`);
    if (target !== "切换权限档") throw new Error(`面板选中项不是切换权限档：${target}`);
    await pressKey("Enter");
    await waitFor(() => js(`!document.querySelector('.cp-panel')`), "palette close");
    await pause(220); // setSettings 桩 30ms + React 一帧 + 提示条渲染
    return true;
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);

  check("首屏是空态（提示条与权限 chip 都在这一屏）", await js(`!!document.querySelector('.composer-card .mode-dot')`), null);
  const initial = await chipText();
  check("初始档来自设置（default ⇒「需要审批」）", initial === "需要审批", initial);

  // 四次动作走完选择面一轮：default → auto → full-access → read-only → default。
  const EXPECTED = [
    { mode: "auto", label: "智能审批", call: 1 },
    { mode: "full-access", label: "完全允许", call: 2 },
    { mode: "read-only", label: "只读", call: 3 },
    { mode: "default", label: "需要审批", call: 4 },
  ];
  let step = 0;
  for (const expected of EXPECTED) {
    step += 1;
    const opened = await cycleViaPalette();
    check(`第 ${step} 次：⌘K 能打开命令面板并选中「切换权限档」`, opened, null);
    const confirmed = await confirmIfAsked();
    const expectConfirm = expected.mode === "auto" || expected.mode === "full-access";
    check(`第 ${step} 次：危险档确认闸${expectConfirm ? "出现并确认" : "不出现"}`, confirmed === expectConfirm, { confirmed, expectConfirm });
    const chip = await chipText();
    const notice = await noticeText();
    const calls = await modeCalls();
    check(`第 ${step} 次：chip 显示「${expected.label}」`, chip === expected.label, chip);
    check(
      `第 ${step} 次：setSettings 收到 mode=${expected.mode}`,
      calls.length === expected.call && calls[expected.call - 1]?.mode === expected.mode,
      calls,
    );
    check(
      `第 ${step} 次：提示条确认「${expected.label}」`,
      typeof notice === "string" && notice.includes(`权限档已切到「${expected.label}」`),
      notice,
    );
    if (expected.mode === "full-access") {
      check("最松档的提示条带同一句风险说明（不是只报档名）", typeof notice === "string" && notice.includes("什么都允许"), notice);
      await pause(250);
      writeFileSync(join(out, "01-full-access.png"), (await win.webContents.capturePage()).toPNG());
    }
  }
  const finalCalls = await modeCalls();
  check("四次动作后补丁序列恰为四档一轮（没有多余写）", finalCalls.length === 4, finalCalls);
  check("回到起点：完整一轮后档位与初始一致", (await chipText()) === initial, await chipText());

  // 设置页四档（2026-11-03 合并后的选择面）：真开设置 → 真点「完全允许」单选项。
  // 这里用真指针点，不用脚本 .click()。
  const pointerOn = async (findExpr) => {
    const point = await js(`(() => {
      const el = ${findExpr};
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(280);
    return true;
  };
  await win.webContents.focus();
  await pressKey(",", ["meta"]);
  const settingsOpen = await waitFor(() => js(`!!document.querySelector('.sp-nav')`), "settings panel");
  check("⌘, 打开设置面板", settingsOpen, null);
  const navClicked = await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.includes('权限与安全'))`);
  check("点到「权限与安全」分区", navClicked, null);
  await waitFor(() => js(`!!document.querySelector('.ss-opt-list[aria-label="权限档"]')`), "permission options");
  const radios = await js(`[...document.querySelectorAll('.ss-opt-list[aria-label="权限档"] .ss-opt')].map((el) => ({ title: el.querySelector('.ss-opt-title')?.textContent ?? '', checked: el.getAttribute('aria-checked'), danger: el.classList.contains('danger') }))`);
  check("设置页列满四档（引导不再出现）", radios.length === 4 && radios.map((r) => r.title).join("|").includes("完全允许") && !radios.map((r) => r.title).join("|").includes("引导"), radios);
  check("盘上档位 default ⇒ 恰一枚选中在「需要审批」", radios.filter((r) => r.checked === "true").length === 1 && radios.find((r) => r.checked === "true")?.title?.startsWith("需要审批"), radios);
  const fullRadioClicked = await pointerOn(`[...document.querySelectorAll('.ss-opt-list[aria-label="权限档"] .ss-opt')].find((el) => el.textContent.includes('完全允许'))`);
  check("真指针点到「完全允许」单选项", fullRadioClicked, null);
  const settingsConfirm = await js(`!!document.querySelector('.confirm-card .cc-title')`);
  check("设置页危险档也先出确认闸", settingsConfirm, null);
  if (settingsConfirm) {
    await js(`document.querySelector('.confirm-card .mini-btn.danger')?.click()`);
    await pause(320);
  }
  await pause(250);
  const afterClick = await js(`(() => {
    const list = document.querySelector('.ss-opt-list[aria-label="权限档"]');
    const opts = [...list.querySelectorAll('.ss-opt')];
    const full = opts.find((el) => el.textContent.includes('完全允许'));
    return {
      calls: window.__cairnSettingsCalls().filter((p) => typeof p.mode === 'string').slice(-1),
      checked: opts.filter((el) => el.getAttribute('aria-checked') === 'true').map((el) => el.querySelector('.ss-opt-title')?.textContent ?? ''),
      danger: full?.classList.contains('danger') ?? false,
      warn: full?.querySelector('.ss-opt-warn')?.textContent ?? '',
    };
  })()`);
  check("点选后写入 mode=full-access", afterClick.calls.length === 1 && afterClick.calls[0].mode === "full-access", afterClick.calls);
  check("点选后恰该档选中（不再出现「全不选中」）", afterClick.checked.length === 1 && afterClick.checked[0] === "完全允许", afterClick.checked);
  check("最松档在设置页带 danger 样式与「最松档」警示", afterClick.danger === true && afterClick.warn.includes("最松档"), afterClick);
  // 设置页 → 活状态：保存后 chip 必须跟着换档，并给出与档位菜单同口径的回执（「下一轮派活生效」）。
  const live = await js(`({ chip: document.querySelector('.composer-card .mode-dot')?.closest('button')?.innerText?.trim() ?? null, notice: document.querySelector('.notice-strip .msg')?.textContent ?? null })`);
  check("设置页保存后 composer chip 同步到「完全允许」", live.chip === "完全允许", live);
  check("设置页保存也给出权限档回执（—— 句式，与面板路径同口径）", typeof live.notice === "string" && live.notice.includes("权限档已切到「完全允许」——"), live.notice);
  writeFileSync(join(out, "02-settings-full-access.png"), (await win.webContents.capturePage()).toPNG());
  await pointerOn(`[...document.querySelectorAll('.ss-opt-list[aria-label="权限档"] .ss-opt')].find((el) => el.textContent.includes('需要审批'))`);
  await pause(250);
  const restored = await js(`window.__cairnSettingsCalls().filter((p) => typeof p.mode === 'string').slice(-1)[0]?.mode ?? null`);
  check("点回「需要审批」恢复测试前档位", restored === "default", restored);

  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[palette-perm-cycle-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error("palette-perm-cycle-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
