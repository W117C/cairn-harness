// CAIRN_SMOKE 一键冒烟（M2-8）：把 M1-6 固化的命令行咒语收进脚本——
//   CAIRN_SMOKE=1 CAIRN_DESKTOP_WORKSPACE=$(mktemp -d) pnpm --filter cairn-desktop exec electron .
// 判据单点在 apps/desktop/src/main/index.ts 的退出码编码里（PASS exit 0 / FAIL exit 1，
// 30s watchdog 强制自退）；本脚本只做四件事：临时工作区生成、环境注入、外圈超时兜底、
// 退出码透传，不复制判据（判据抄第二份就会漂）。
// 外圈超时（M3-7，M2 终审 triage 收口）：watchdog 要到 main load 之后才武装，load 前挂死
// 它管不着——没有外圈超时，pnpm smoke 会无限阻塞。45s = 30s 自退窗口 + 15s 余量；
// 超时 Node 发 killSignal（SIGTERM）并置 error.code="ETIMEDOUT"，下方按 FAIL 处理。
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 本文件在 <repo>/apps/desktop/scripts/ 下：三层向上才是仓库根（scripts → desktop → apps → 根）。
// 钉 repo 根做 cwd，让 --filter 与手跑咒语同一路径解析；exec 仍会在 cairn-desktop 包目录里跑 electron。
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// 冒烟工作区（会话/事件落点）：mkdtemp 显式生成，不回落 $HOME——与 main/index.ts 的隔离纪律同源
// （index.ts 对空 CAIRN_DESKTOP_WORKSPACE 直接拒跑）。跑完不删：失败时留现场可查，/tmp 周期清理兜底。
const workspace = mkdtempSync(join(tmpdir(), "cairn-smoke-ws-"));

// electron 解析走 pnpm --filter exec（吃 cairn-desktop 自己 node_modules/.bin 的 electron），
// 与手跑同一路径；stdio inherit 让 [cairn-smoke] 判卷行原样透到调用方终端。
// ELECTRON_RUN_AS_NODE **不许**进子进程：它把 Electron 降级成纯 Node（app 为 undefined），
// 冒烟会在 load 之前就挂掉。开发本仓的宿主（DSH）把该变量注入每个 shell ⇒ 不清掉就是恒红。
const childEnv = { ...process.env, CAIRN_SMOKE: "1", CAIRN_DESKTOP_WORKSPACE: workspace };
delete childEnv.ELECTRON_RUN_AS_NODE;

const result = spawnSync("pnpm", ["--filter", "cairn-desktop", "exec", "electron", "."], {
  cwd: repoRoot,
  stdio: "inherit",
  env: childEnv,
  timeout: 45_000,
});

if (result.error) {
  // 超时形态（error.code === "ETIMEDOUT"，signal 同步置为 killSignal）与 spawn 本身失败
  // （ENOENT 等）分开报：诊断行要点名"load 前挂死"这个形态，别让调用方去猜 45s 是谁定的。
  if (result.error.code === "ETIMEDOUT") {
    console.error(
      "[cairn-smoke] 超时：45s 内 electron 未自退（load 前挂死形态，M2 终审 triage 收口），" +
        "killSignal 已发，按 FAIL 处理；冒烟工作区留存待查：",
      workspace,
    );
  } else {
    console.error("[cairn-smoke] spawn 失败：", result.error.message);
  }
  process.exit(1);
}
// 透传退出码；被信号打死时 status 为 null，按 FAIL 处理（exit 1），信号名透出留诊断。
if (result.signal) {
  console.error("[cairn-smoke] 子进程被信号终止：", result.signal, "——按 FAIL 处理。");
}
process.exit(result.status ?? 1);
