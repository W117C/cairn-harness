// M0_SMOKE 一键冒烟（M2-8）：把 M1-6 固化的命令行咒语收进脚本——
//   M0_SMOKE=1 M0_DESKTOP_WORKSPACE=$(mktemp -d) pnpm --filter m0-desktop exec electron .
// 判据单点在 apps/desktop/src/main/index.ts 的退出码编码里（PASS exit 0 / FAIL exit 1，
// 30s watchdog 强制自退）；本脚本只做三件事：临时工作区生成、环境注入、退出码透传，
// 不复制判据（判据抄第二份就会漂）。
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 本文件在 <repo>/apps/desktop/scripts/ 下：三层向上才是仓库根（scripts → desktop → apps → 根）。
// 钉 repo 根做 cwd，让 --filter 与手跑咒语同一路径解析；exec 仍会在 m0-desktop 包目录里跑 electron。
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// 冒烟工作区（会话/事件落点）：mkdtemp 显式生成，不回落 $HOME——与 main/index.ts 的隔离纪律同源
// （index.ts 对空 M0_DESKTOP_WORKSPACE 直接拒跑）。跑完不删：失败时留现场可查，/tmp 周期清理兜底。
const workspace = mkdtempSync(join(tmpdir(), "m0-smoke-ws-"));

// electron 解析走 pnpm --filter exec（吃 m0-desktop 自己 node_modules/.bin 的 electron），
// 与手跑同一路径；stdio inherit 让 [m0-smoke] 判卷行原样透到调用方终端。
const result = spawnSync("pnpm", ["--filter", "m0-desktop", "exec", "electron", "."], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, M0_SMOKE: "1", M0_DESKTOP_WORKSPACE: workspace },
});

if (result.error) {
  console.error("[m0-smoke] spawn 失败：", result.error.message);
  process.exit(1);
}
// 透传退出码；被信号打死时 status 为 null，按 FAIL 处理（exit 1）。
process.exit(result.status ?? 1);
