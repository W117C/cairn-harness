// 浮层互斥 · 真机判卷（2026-10-28 · 第 752 页）：真实 renderer + 真实 dist，
// 量「模型菜单开着时点用量环」之后屏幕上还剩几个浮层，以及两个浮层的几何是否重叠。
//
// 为什么必须真机：这条缺陷的本体是**两个独立 open 态在同一处各开各的**——源码上
// 「ModelPicker 有自己的 setOpen」这一点就足以看出风险，但要证「同屏叠放且真的重叠」，
// 必须量真实 DOM 的几何与命中测试。
//
// 用法（先 build）：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE \
//   ./node_modules/.bin/electron scripts/overlay-mutex-smoke.cjs outputs/overlay-mutex-752
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-overlay-mutex-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-overlay-mutex-"));
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
    isArray: /Promise<[^>]*[\]>]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)),
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
  const js = async (source) => {
    try {
      return await win.webContents.executeJavaScript(source);
    } catch (err) {
      errors.push(`probe-js: ${String(err && err.message ? err.message : err)}`);
      return null;
    }
  };
  const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };
  // 屏上浮层：`.pop.show` 是所有自绘浮层的公共类（模型菜单 `pop up show mp-pop`、
  // 用量浮层 `pop up show`）。
  const overlayState = () => js(`(() => {
    const pops = Array.from(document.querySelectorAll('.pop.show'));
    const mp = document.querySelector('.mp-pop');
    const usage = pops.find((p) => !p.classList.contains('mp-pop')) ?? null;
    const r1 = mp?.getBoundingClientRect() ?? null;
    const r2 = usage?.getBoundingClientRect() ?? null;
    const overlap = r1 !== null && r2 !== null
      && !(r2.left > r1.right || r2.right < r1.left || r2.top > r1.bottom || r2.bottom < r1.top);
    return { count: pops.length, classes: pops.map((p) => p.className), modelOpen: !!mp, usageOpen: !!usage, overlap };
  })()`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(700);
  await js(`document.querySelector('.session')?.click()`);
  await pause(600);

  // ① 模型菜单单独开着：屏上只有它。
  await js(`document.querySelector('.mp-trigger')?.click()`);
  await pause(450);
  const onlyModel = await overlayState();
  check("模型菜单单独开着：屏上只有它一个", onlyModel?.count === 1 && onlyModel?.modelOpen === true, onlyModel);

  // ② 模型菜单开着时点用量环 ⇒ **不许**同屏两个（缺陷本体：模型菜单与用量环各开各的，
  //    真机复现时两个浮层几何真的重叠、用量浮层盖住模型菜单右半）。
  const ringClicked = await js(`(() => {
    const r = document.querySelector('.usage-ring');
    if (!r) return { clicked: false };
    r.click();
    return { clicked: true };
  })()`);
  await pause(500);
  const afterRing = await overlayState();
  check(
    "模型菜单开着点用量环 ⇒ 只剩一个浮层（模型菜单让路），且不重叠",
    ringClicked?.clicked === true && afterRing?.count === 1 && afterRing?.usageOpen === true
      && afterRing?.modelOpen === false && afterRing?.overlap === false,
    { ringClicked, afterRing },
  );

  // ④ 反过来：用量环开着时点模型菜单 ⇒ 也只该有一个。
  await js(`document.querySelector('.mp-trigger')?.click()`);
  await pause(450);
  const reverse = await overlayState();
  check("反向同样互斥（用量环开着点模型菜单 ⇒ 只剩模型菜单）",
    reverse?.count === 1 && reverse?.modelOpen === true && reverse?.usageOpen === false, reverse);

  // ⑤ 模型菜单仍能正常开合（互斥没有把功能改坏）。
  await js(`document.querySelector('.mp-trigger')?.click()`);
  await pause(400);
  const closed = await overlayState();
  check("模型菜单仍能自己开、自己关", closed?.count === 0, closed);

  check("渲染过程无控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`读数：${checks.length} 条，${checks.length - failed.length} 绿 / ${failed.length} 红 → ${out}`);
  if (failed.length > 0) process.exitCode = 1;
  win.destroy();
}

main().catch((err) => { console.error("overlay-mutex-smoke failed:", err); process.exitCode = 1; });
