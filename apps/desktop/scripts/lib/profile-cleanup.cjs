// 冒烟 profile 清理（2026-11-12，第 1068 页）——桌面冒烟 harness 的单一事实源。
//
// 为什么不能直接在 app.on("quit") / process.on("exit") 里 rmSync(profile)：
//   钩子内 rmSync 会“成功”（删完 exists=false），但 Chromium 原生退出阶段在 JS 钩子之后
//   重建 Local State / Network Persistent State / Preferences / Session Storage（leveldb），
//   profile 目录随即复现 ⇒ 泄漏到 $TMPDIR。app.exit 与 app.quit 同病——第 1062 页登记的
//   “app.exit 跳过 quit 钩子”根因被探针证伪（两种退出都触发 quit＋process-exit、rmSync 都成功）。
//
// 修法：从一个比 Electron 活得久的进程里延迟删。detached 的 electron-as-node 子进程等原生
//   退出落定（CLEANUP_DELAY_MS）后 rmSync，把重建出来的残壳一并清掉。跨平台、无 shell：
//   profile 与延迟都走 argv，-e 脚本是纯常量串，零注入面。
//
// 用法：app.on("quit", () => scheduleProfileCleanup(profile));
const { spawn } = require("node:child_process");

// 1.2s 足够 Chromium 原生退出把残壳落定（探针实测：app.exit 后 ~0.6s 内重建完成）。
const CLEANUP_DELAY_MS = 1200;

function scheduleProfileCleanup(profile) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs');setTimeout(()=>{try{fs.rmSync(process.argv[1],{recursive:true,force:true})}catch{}},Number(process.argv[2]))",
      profile,
      String(CLEANUP_DELAY_MS),
    ],
    { detached: true, stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
  child.unref();
}

module.exports = { scheduleProfileCleanup };