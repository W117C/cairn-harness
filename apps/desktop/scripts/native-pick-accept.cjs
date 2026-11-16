// 原生面板点选的**人工验收**脚本（唯一判不到的那一跳）。
//
// 为什么需要它：Electron 没有「替人点面板」的 API，`osascript` 走 UI 自动化在本机又拿不到辅助功能权限。
// 所以这一跳不能自动化——但可以**一条命令跑完**：脚本打开真窗口、弹真系统面板，
// 你点一个文件（或取消），脚本把结果打成人能读的读数并存成 JSON。
//
// 用法：
//   ELECTRON_OVERRIDE_DIST_PATH=… npx electron scripts/native-pick-accept.cjs [输出目录]
// 判读：
//   PASS 选中 → 面板真的把路径交回来了（kind/path 都在）
//   PASS 取消 → canceled=true（取消是合法结果）
//   超时 60s 无人操作 → TIMEOUT（这条不算通过，也不算失败，就是没验）
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { verdictOf, verdictReason } = require("./../src/main/native-pick-verdict.ts");
const { join } = require("node:path");

const out = process.argv[2] || join(process.cwd(), "outputs", "native-pick-accept");
const WAIT_MS = Number(process.env.CAIRN_NATIVE_PICK_WAIT_MS ?? 60_000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 720, height: 420, show: true, title: "壁纸 · 原生面板点选验收" });
  await win.loadURL("data:text/html," + encodeURIComponent(
    "<body style='font:14px -apple-system;padding:24px;background:#151515;color:#f0efec'>" +
    "<h2>原生面板点选验收</h2>" +
    "<p>接下来会弹出系统的选文件面板。</p>" +
    "<p>请<b>点中一张图片或一个视频</b>（或点取消）。60 秒内没有操作记为 TIMEOUT。</p></body>",
  ));

  const started = Date.now();
  const picked = await Promise.race([
    dialog.showOpenDialog(win, {
      title: "选择壁纸",
      properties: ["openFile"],
      filters: [{ name: "图片与视频", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "webm", "mov"] }],
    }),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), WAIT_MS)),
  ]);

  const elapsedMs = Date.now() - started;
  const first = Array.isArray(picked.filePaths) ? picked.filePaths[0] : undefined;
  const verdict = verdictOf(picked);
  const record = { verdict, elapsedMs, canceled: picked.canceled ?? null, path: first ?? null, at: new Date().toISOString() };

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "native-pick-accept.json"), JSON.stringify(record, null, 2));
  console.log("native-pick-accept " + JSON.stringify(record));
  console.log("判读：" + verdictReason(verdict));
  console.log("读数已写入 " + join(out, "native-pick-accept.json"));
  app.exit(verdict.startsWith("PASS") ? 0 : 2);
});
