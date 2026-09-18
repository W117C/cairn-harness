// 原生件可用性探针：在本仓真实渲染进程（Electron 44 / Chromium 152）里实测 P2 减法依赖的平台能力。
// 跑法（需先 pnpm build），单行直接复制即可：
//   ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron outputs/native-capability-probe-2026-09-19.js "$PWD/out/renderer/index.html"
// 预期输出：PROBE_RESULT {...} 且 27 项全 true；任何一项转 false/ERR 即该条减法的前提失效。
const { app, BrowserWindow } = require("electron");
const path = require("path");

// ⚠️ 复跑约束（实测）：必须与 Electron 类门禁**串行**、且宿主负载低时跑。
//   本脚本在 load 5+ 时启动即挂（卡在原生初始化阶段——下面 45s 看门狗都轮不到执行，只能外部 pkill）。
//   挂住 ≠ 能力缺失，别据此推翻结论；成功读数已捕获在同目录 native-capability-2026-09-19.md
//   （27/27 true，连跑两次一致）。另：为"隔离"去 setPath("userData", 新目录) 无效，问题不在 profile。
setTimeout(() => { console.log("PROBE_TIMEOUT 45s 未出结果"); app.exit(2); }, 45000);

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: { contextIsolation: true, sandbox: false },
  });
  await win.loadFile(path.resolve(process.argv[2]));
  const out = await win.webContents.executeJavaScript(`(() => {
    const safe = (fn) => { try { return fn(); } catch (e) { return "ERR:" + (e && e.name ? e.name : String(e)).slice(0, 60); } };
    const s = (q) => safe(() => CSS.supports(q));
    const at = (rule) => safe(() => { const x = new CSSStyleSheet(); x.replaceSync(rule); return true; });
    const d = document.createElement("div");
    d.setAttribute("popover", "");
    return safe(() => ({
      uaChrome: (navigator.userAgent.match(/Chrome\\/[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+/) || ["n/a"])[0],
      popoverInProto: "popover" in HTMLElement.prototype,
      popoverAttrValue: String(d.popover),
      popoverTargetElement: "popoverTargetElement" in HTMLButtonElement.prototype,
      allowDiscrete: s("transition-behavior: allow-discrete"),
      startingStyleRule: at("@starting-style { :root { opacity: 0 } }"),
      anchorName: s("anchor-name: --a"),
      positionAnchor: s("position-anchor: --a"),
      positionTryFallbacks: s("position-try-fallbacks: flip-block"),
      positionTryOrder: s("position-try-order: most-height"),
      anchorSizeFn: s("width: anchor-size(--a width)"),
      dialogElement: typeof HTMLDialogElement === "function",
      dialogShowModal: typeof HTMLDialogElement === "function" && typeof document.createElement("dialog").showModal === "function",
      dialogBackdropRule: at("dialog::backdrop { color: red }"),
      lightDark: s("color: light-dark(red, blue)"),
      fieldSizing: s("field-sizing: content"),
      containerType: s("container-type: inline-size"),
      containerQueryRule: at("@container x (min-width: 1px) { .a { color: red } }"),
      hasSelector: s("selector(:has(*))"),
      contentVisibility: s("content-visibility: auto"),
      startViewTransition: typeof document.startViewTransition === "function",
      colorMix: s("color: color-mix(in oklab, red 50%, blue)"),
      oklch: s("color: oklch(50% 0.1 200)"),
      textWrapBalance: s("text-wrap: balance"),
      scopeRule: at("@scope (.a) { .b { color: red } }"),
      layerRule: at("@layer a;"),
      detailsSupported: typeof document.createElement("details").open === "boolean",
    }));
  })()`);
  console.log("PROBE_RESULT " + JSON.stringify(out, null, 1));
  app.quit();
}).catch((err) => { console.log("PROBE_ERROR " + (err && err.message ? err.message : String(err))); app.exit(1); });
