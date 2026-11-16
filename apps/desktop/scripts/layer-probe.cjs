// 「网站作为壁纸」的**可行性探针**：不猜，测两件事。
//
// 方案 A（另开受限窗口当壁纸层）要成立，前提是「壁纸窗口稳定位于主窗口之下」。
// 判这一点需要**看屏幕**（z-order 没有 API）。所以探针先测：这台机器能不能截屏。
// 同时记录窗口属性（showInactive / ignoreMouse / alwaysOnTop），供归档。
//
// 用法：ELECTRON_OVERRIDE_DIST_PATH=… npx electron scripts/layer-probe.cjs [输出目录]
// 输出：<out>/layer-probe.json（含 capturable / error / windows）
const { app, BrowserWindow, desktopCapturer, systemPreferences } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const out = process.argv[2] || join(process.cwd(), "outputs", "layer-probe");

app.whenReady().then(async () => {
  const record = { at: new Date().toISOString(), capturable: false, error: null, windows: [], screenPermission: null };

  try {
    // macOS 上截图权限是单独的（Screen Recording）；读一下当前状态（拿不到就记 null）。
    record.screenPermission = typeof systemPreferences.getMediaAccessStatus === "function"
      ? systemPreferences.getMediaAccessStatus("screen")
      : "unknown";
  } catch (error) {
    record.screenPermission = "error: " + String(error);
  }

  const wall = new BrowserWindow({ width: 800, height: 600, frame: false, show: false, focusable: false, hasShadow: false });
  await wall.loadURL("data:text/html,<body style='margin:0;background:%23222;color:%23eee'>wallpaper layer</body>");
  wall.showInactive();
  wall.setIgnoreMouseEvents(true);

  const main = new BrowserWindow({ width: 900, height: 640, show: true });
  await main.loadURL("data:text/html,<body style='background:%23fff'>app window</body>");
  main.focus();

  await new Promise((r) => setTimeout(r, 600));

  record.windows = [
    { role: "wallpaper", visible: wall.isVisible(), focused: wall.isFocused(), alwaysOnTop: wall.isAlwaysOnTop() },
    { role: "main", visible: main.isVisible(), focused: main.isFocused(), alwaysOnTop: main.isAlwaysOnTop() },
  ];

  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 320, height: 200 } });
    record.capturable = sources.length > 0;
    record.sources = sources.map((s) => ({ name: s.name, hasThumbnail: !s.thumbnail.isEmpty() }));
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "layer-probe.json"), JSON.stringify(record, null, 2));
  console.log("layer-probe " + JSON.stringify(record));
  app.exit(0);
});
