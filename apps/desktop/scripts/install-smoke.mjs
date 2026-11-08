// 安装盘验收（2026-10-30 · 第 831 页）：
// 把 DMG 挂起来 -> 把 Cairn.app 复制到临时目录（模拟拖进 Applications）-> 跑打包态冒烟。
// 证明「离开 release 目录的 app bundle」仍然能启动，而不是只在打包目录里碰巧能跑。
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PACKAGED_SMOKE_ARGS, packagedSmokePassed } from "./package.mjs";

const dmg = resolve(process.argv[2] ?? "");
if (!existsSync(dmg)) {
  console.error("用法：node apps/desktop/scripts/install-smoke.mjs <Cairn.dmg>");
  process.exit(2);
}
const mounted = mkdtempSync(join(tmpdir(), "cairn-install-smoke-"));
const workspace = mkdtempSync(join(tmpdir(), "cairn-install-workspace-"));
let mountPoint = null;
try {
  const attach = spawnSync("diskutil", ["image", "attach", dmg], { encoding: "utf8" });
  if (attach.status !== 0) throw new Error(`挂载失败：${attach.stderr.trim()}`);
  const points = String(attach.stdout).match(/\/Volumes\/[^\s]+/g);
  mountPoint = points?.[points.length - 1] ?? null;
  if (mountPoint === null) throw new Error("挂载输出里没有 /Volumes 路径");
  const app = join(mountPoint, "Cairn.app");
  if (!existsSync(app)) throw new Error(`安装盘里没有 Cairn.app：${app}`);
  if (!existsSync(join(mountPoint, "Applications"))) throw new Error("安装盘里没有 Applications 快捷方式");
  const copied = join(mounted, "Cairn.app");
  // 必须用 ditto：cpSync 会丢签名相关 xattr/ACL，复制出来的 app 可能起不来。
  const copy = spawnSync("ditto", [app, copied], { encoding: "utf8" });
  if (copy.status !== 0) throw new Error(`复制 Cairn.app 失败：${copy.stderr.trim()}`);
  const env = { ...process.env, CAIRN_SMOKE: "1", CAIRN_DESKTOP_WORKSPACE: workspace };
  for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_PATH", "VITE_DEV_SERVER_URL", "M0A_PROVIDER", "M3A_MAIN_SCRIPT"]) delete env[key];
  const smoke = spawnSync(join(copied, "Contents/MacOS/Cairn"), PACKAGED_SMOKE_ARGS, { cwd: workspace, env, encoding: "utf8", timeout: 45_000, killSignal: "SIGKILL" });
  const passed = packagedSmokePassed(smoke);
  if (!passed) {
    console.error(`安装后冒烟失败（需要 [cairn-smoke] PASS 凭据，status=${String(smoke.status)}）\n${String(smoke.stdout).slice(-2000)}\n${String(smoke.stderr).slice(-2000)}`);
    process.exitCode = 1;
  } else {
    console.log("[install-smoke] PASS：从 DMG 拖出的 Cairn.app 启动并通过打包态冒烟");
  }
} catch (err) {
  console.error(`[install-smoke] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  if (mountPoint !== null) {
    const detached = spawnSync("diskutil", ["eject", mountPoint], { encoding: "utf8" });
    if (detached.status !== 0) {
      const fallback = spawnSync("hdiutil", ["detach", mountPoint], { encoding: "utf8" });
      if (fallback.status !== 0) {
        console.error(`[install-smoke] 无法卸载本轮安装盘：${mountPoint}`);
        process.exitCode = 1;
      }
    }
  }
  rmSync(mounted, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
}
