// Cairn 桌面打包（2026-10-06 接管笔）：把「零打包 + tsx 直跑 TS 源」的运行架构**整体装箱**，
// 而不是把 core 链 esbuild 进 bundle——后者会把 agent-runner 的 ROOT 漂到 bundle 目录，
// fixtures/相对语义全部失真（entry.cjs 头注立的案）。装箱后相对布局原样保真：
//   Cairn.app/Contents/Resources/app/  ← 仓库布局（package.json + src/ + apps/desktop/ + fixtures/）
//   Cairn.app/Contents/Resources/app/node_modules/  ← 运行期真依赖（npm 装出 closure，非 pnpm 符号链接）
// main 入口 = Resources/app/apps/desktop/src/main/entry.cjs（Electron 从 Resources/app/package.json
// 的 "main" 解析），tsx 的 resolve({paths:[repoRoot]}) 落在 Resources/app ✓。
//
// 为什么不用 electron-builder：pnpm 工作区 + 根级 TS 源布局不在它的收集模型里，配置面比这百来行
// shell 逻辑更脆；本脚本只用 macOS 自带工具（PlistBuddy / codesign / hdiutil）+ npm（装运行期
// closure），**零新增依赖**。
//
// 产物：release/Cairn.app（可直接双击；arm64 上必须 ad-hoc 签名——改过 bundle 的原件签名已失效，
// 不重签会被 SIGKILL）与 release/Cairn.dmg（hdiutil；未公证，首次打开右键 → 打开，或 xattr -cr）。
// 验收：CAIRN_SMOKE=1 跑打包后的二进制走完真窗口冒烟（与开发态同一份判据，见 main/index.ts）。
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url))); // apps/desktop
const repoRoot = join(desktopDir, "..", "..");
const releaseDir = join(desktopDir, "release");
// electron 是 cairn-desktop 的 devDep ⇒ 二进制在本包 node_modules（pnpm 符号链接已由 cpSync 解引用）；
// 根 node_modules 留作回退（有人把它提到根时仍然能跑）。
const electronDist = [join(desktopDir, "node_modules", "electron", "dist", "Electron.app"), join(repoRoot, "node_modules", "electron", "dist", "Electron.app")]
  .find((p) => existsSync(p));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`[package] FAIL: ${cmd} ${args.join(" ")} 退出码 ${String(r.status)}`);
    process.exit(1);
  }
}

if (!existsSync(electronDist)) {
  console.error("[package] FAIL: 未找到 Electron 运行时（先 pnpm install）：", electronDist);
  process.exit(1);
}

// ① 构建：preload（esbuild）+ 渲染包（vite）。main 保持 TS 源——tsx 在包内直跑（见文件头）。
run("pnpm", ["--filter", "cairn-desktop", "build:preload"], { cwd: repoRoot });
run("pnpm", ["--filter", "cairn-desktop", "exec", "vite", "build"], { cwd: repoRoot });

// ② 组壳：Electron.app → Cairn.app；主执行体与 Info.plist 同步改名（辅助进程保持原名——
//    那是签名一致性的事，本地 ad-hoc 运行不依赖它）。
//    ⚠️ 壳拷贝必须用 ditto（或 BSD cp -R），**不能用 node cpSync**：后者会把 framework 的相对
//    符号链接（Versions/Current → A）改写成指向 pnpm store 的**绝对路径**（实测 2026-10-06）——
//    装进 .app 后子进程/签名顺链摸回 node_modules，GPU 子进程 SIGTRAP、codesign verify 直接
//    「No such file or directory」。
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
const appDir = join(releaseDir, "Cairn.app");
run("ditto", [electronDist, appDir]);
const macDir = join(appDir, "Contents", "MacOS");
renameSync(join(macDir, "Electron"), join(macDir, "Cairn"));
const plist = join(appDir, "Contents", "Info.plist");
// Set 在键缺席时退出非零 ⇒ Set 失败改 Add。（二分实测 2026-10-06：改名+这三项 plist+ad-hoc 重签
// 组合冒烟 PASS；⚠️ 不要把 framework 的 icu/pak/快照「下放」到 app 层 Resources——打包态加载器
// 会优先吃 app 层那份**不完整**集（arm64 后缀快照等），反而炸 ICU/GPU——框架内层自己的资源是全的。）
for (const [key, value] of [
  ["CFBundleExecutable", "Cairn"],
  ["CFBundleName", "Cairn"],
  ["CFBundleIdentifier", "com.cairn.desktop"],
  ["CFBundleIconFile", "cairn.icns"],
]) {
  const set = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
  if (set.status !== 0) run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plist]);
}

cpSync(join(desktopDir, "src", "renderer", "public", "brand", "cairn.icns"), join(appDir, "Contents", "Resources", "cairn.icns"));

// ③ 运行期布局：Resources/app = 仓库布局的运行期子集。
//    package.json 的 "main" 指 entry.cjs；dependencies 带上根包全部生产依赖 + tsx（loader 本体，
//    devDep 但运行期要用）——④ 的 npm install 按这份清单装出真实文件的完整 closure。
const appRes = join(appDir, "Contents", "Resources", "app");
mkdirSync(appRes, { recursive: true });
const appPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const runtimePkg = {
  // name 会成为 safeStorage 的钥匙串条目名（「<name> Safe Storage」）——用 cairn，
  // 用户在钥匙串/系统弹窗里看到的就是 Cairn，不是内部包名（2026-10-06 实测弹窗 "cairn-desktop-runtime Safe Storage"）。
  name: "cairn",
  private: true,
  main: "apps/desktop/src/main/entry.cjs",
  dependencies: { ...appPkg.dependencies, tsx: appPkg.devDependencies.tsx },
};
writeFileSync(join(appRes, "package.json"), JSON.stringify(runtimePkg, null, 2) + "\n");
for (const rel of ["src", "tsconfig.json"]) {
  const from = join(repoRoot, rel);
  if (existsSync(from)) cpSync(from, join(appRes, rel), { recursive: true });
}
// fixtures 保留（core 的 ROOT 相对语义可能引用），但要滤掉运行残留：todo-app 靶子的 node_modules
// 里躺着指向 /tmp bench worktree 的**悬空符号链接**（实测 2026-10-06）——进 bundle 会让
// codesign --verify 报「No such file or directory」（封印面有悬空路径）。.agent/ 同为运行产物。
cpSync(join(repoRoot, "fixtures"), join(appRes, "fixtures"), {
  recursive: true,
  filter: (src) => !src.includes("node_modules") && !src.includes(`${sep}.agent`) && !src.endsWith(".agent"),
});
cpSync(join(repoRoot, "apps", "desktop", "src"), join(appRes, "apps", "desktop", "src"), { recursive: true });
cpSync(join(repoRoot, "apps", "desktop", "dist"), join(appRes, "apps", "desktop", "dist"), { recursive: true });
cpSync(join(repoRoot, "apps", "desktop", "dist-electron"), join(appRes, "apps", "desktop", "dist-electron"), { recursive: true });
cpSync(join(repoRoot, "apps", "desktop", "package.json"), join(appRes, "apps", "desktop", "package.json"));

// ④ 运行期 node_modules：npm 装出真实文件的完整闭包（pnpm 的符号链接布局进不了 .app）。
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: appRes });

// ⑤ ad-hoc 签名（arm64 硬要求）+ 分发件。只签**外层** bundle：主执行体改名 + Info.plist 变更
//    使原件失效，重签外层即够；内嵌 Framework/Helper 的原厂签名原样保留（内容未动）——
//    --deep 会把它们也重签，反而报「unsealed contents」（实测 2026-10-06）。
run("codesign", ["--force", "--sign", "-", appDir]);
// 分发件：DMG 优先（hdiutil 在部分环境报「功能未实现」——实测本机如此）⇒ 失败降级 ditto zip
// （保留 .app bundle 结构的正确 mac zip）。两条路都只是「给 .app 穿运输壳」，.app 本身就能跑。
const dmg = spawnSync("hdiutil", ["create", "-volname", "Cairn", "-srcfolder", appDir, "-ov", "-format", "udzo", join(releaseDir, "Cairn.dmg")]);
if (dmg.status === 0) {
  console.log("[package] 完成：", join(releaseDir, "Cairn.dmg"));
} else {
  console.error("[package] hdiutil 不可用（" + String(dmg.status) + "），降级 zip：");
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appDir, join(releaseDir, "Cairn-macOS.zip")]);
  console.log("[package] 完成：", join(releaseDir, "Cairn-macOS.zip"));
}
console.log("[package] 完成：", appDir);
