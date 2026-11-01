// Keep the source layout intact: the core's import.meta/fixture paths must survive packaging.
// pnpm deploy supplies a locked, isolated production dependency tree; no second npm resolution.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(desktopDir, "..", "..");

export function makeRuntimePackage(source) {
  return {
    // This name also identifies Cairn's safeStorage keychain entry.
    name: "cairn",
    version: source.version,
    type: source.type,
    private: true,
    main: "apps/desktop/src/main/entry.cjs",
    dependencies: { ...source.dependencies },
  };
}

export function readSourceProvenance(root) {
  const git = (args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    if (result.error || result.signal || result.status !== 0) throw new Error("无法读取构建来源：需要可读的 Git 工作树");
    return result.stdout.trim();
  };
  return {
    sourceCommit: git(["rev-parse", "--verify", "HEAD"]),
    sourceDirty: git(["status", "--porcelain", "--untracked-files=normal"]) !== "",
  };
}

export function preparePackageStaging(root, out) {
  const sourceProvenance = readSourceProvenance(root);
  mkdirSync(dirname(out), { recursive: true });
  return { sourceProvenance, staging: mkdtempSync(join(dirname(out), ".cairn-package-")) };
}

export function codeSigningTargets(appDir) {
  const targets = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue; // Framework aliases must not be traversed twice.
      const path = join(directory, entry.name);
      visit(path);
      if (/\.(app|framework|xpc)$/.test(entry.name)) targets.push(path);
    }
  };
  const frameworks = join(appDir, "Contents/Frameworks");
  if (existsSync(frameworks)) visit(frameworks);
  return [...targets, appDir];
}

// Ad-hoc signing changes the CDHash on every build; macOS then blocks the first keychain
// lookup on the ACL prompt. The smoke isolates that with Chromium's in-memory keychain, so
// the packaged process still exercises safeStorage without depending on a human to approve.
export const PACKAGED_SMOKE_ARGS = ["--use-mock-keychain"];

export function packagedSmokePassed(result) {
  return result.status === 0 && !result.error && !result.signal
    && /^\[cairn-smoke\] PASS in \d+ ms\r?$/m.test(result.stdout ?? "");
}

export function pruneRuntimeState(root, allowedFixturePaths) {
  const visit = (directory, inAgent = false) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const rel = relative(root, path).split(sep).join("/");
      if ([".mimosa", ".git", ".DS_Store", "node_modules"].includes(entry.name)
        || (entry.name === ".agent" && (!rel.startsWith("fixtures/") || entry.isSymbolicLink()))) {
        rmSync(path, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        visit(path, inAgent || entry.name === ".agent");
        if ((inAgent || entry.name === ".agent") && readdirSync(path).length === 0) rmSync(path, { recursive: true });
      } else if (inAgent && (!allowedFixturePaths.has(rel) || entry.isSymbolicLink())) {
        rmSync(path, { force: true });
      }
    }
  };
  for (const payload of ["src", "fixtures", "apps/desktop/src"]) {
    const path = join(root, payload);
    if (existsSync(path)) visit(path);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error || result.signal || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} 失败：${result.error?.message ?? result.signal ?? result.status}`);
  }
  return result;
}

function occupied(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function optionsOf(args) {
  const options = { out: join(desktopDir, "release"), archive: true, help: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") options.help = true;
    else if (args[i] === "--no-archive") options.archive = false;
    else if (args[i] === "--out" && args[i + 1] && !args[i + 1].startsWith("--")) options.out = resolve(args[++i]);
    else throw new Error(`未知或缺值的打包参数：${args[i]}`);
  }
  return options;
}

function packageDesktop(options) {
  if (occupied(options.out)) throw new Error(`目标已存在：${options.out}；请用 --out 选择新目录，已有产物不会被覆盖`);
  if (process.platform !== "darwin") throw new Error("当前打包入口支持 macOS；请在 macOS 构建 Cairn.app");
  const electronDist = [join(desktopDir, "node_modules/electron/dist/Electron.app"), join(repoRoot, "node_modules/electron/dist/Electron.app")]
    .find(path => existsSync(path));
  if (!electronDist) throw new Error("未找到 Electron 运行时，请先安装仓库声明的依赖");
  const source = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  if (!source.dependencies?.tsx) throw new Error("tsx 是运行期 loader，必须声明在 dependencies 中");
  run("pnpm", ["--filter", "cairn-desktop", "build"], { cwd: repoRoot });
  const { sourceProvenance, staging } = preparePackageStaging(repoRoot, options.out);
  try {
    const appDir = join(staging, "Cairn.app");
    // ditto preserves framework-relative symlinks; Node's default cp rewrites them.
    run("ditto", [electronDist, appDir]);
    renameSync(join(appDir, "Contents/MacOS/Electron"), join(appDir, "Contents/MacOS/Cairn"));
    const plist = join(appDir, "Contents/Info.plist");
    for (const [key, value] of [
      ["CFBundleExecutable", "Cairn"], ["CFBundleName", "Cairn"],
      ["CFBundleIdentifier", "com.cairn.desktop"], ["CFBundleIconFile", "cairn.icns"],
      ["CFBundleShortVersionString", source.version], ["CFBundleVersion", source.version.split(/[+-]/)[0]],
    ]) {
      const set = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
      if (set.status !== 0) run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plist]);
    }
    cpSync(join(desktopDir, "src/renderer/public/brand/cairn.icns"), join(appDir, "Contents/Resources/cairn.icns"));
    const appRes = join(appDir, "Contents/Resources/app");
    run("pnpm", ["--filter=cairn-harness", "deploy", "--prod", "--ignore-scripts", "--config.injectWorkspacePackages=true", appRes], { cwd: repoRoot });
    // Nested workspace ignore rules omit generated files from deploy, even with a files whitelist.
    for (const directory of ["dist", "dist-electron"]) {
      cpSync(join(desktopDir, directory), join(appRes, "apps/desktop", directory), { recursive: true });
    }
    const tracked = run("git", ["ls-files", "-z", "--", "fixtures"], { cwd: repoRoot, stdio: "pipe", encoding: "utf8" });
    pruneRuntimeState(appRes, new Set(tracked.stdout.split("\0").filter(Boolean)));
    writeFileSync(join(appRes, "package.json"), JSON.stringify(makeRuntimePackage(source), null, 2) + "\n");
    // 关于页读这一份：构建时间、签名方式、lock 哈希与打包冒烟凭据都随包走。
    const buildInfo = {
      version: source.version, platform: process.platform, arch: process.arch,
      ...sourceProvenance,
      sourceLockSha256: createHash("sha256").update(readFileSync(join(repoRoot, "pnpm-lock.yaml"))).digest("hex"),
      packagedSmoke: "passed", signature: "ad-hoc", createdAt: new Date().toISOString(),
    };
    writeFileSync(join(appRes, "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n");
    // Re-seal nested code inside out; some installed Electron runtimes lack resource seals.
    for (const target of codeSigningTargets(appDir)) {
      run("codesign", ["--force", "--sign", "-", "--preserve-metadata=entitlements,flags", target]);
    }
    run("codesign", ["--verify", "--deep", "--strict", appDir]);

    // Prove the deployed native search tool is executable, independent of the source checkout.
    const executable = join(appDir, "Contents/MacOS/Cairn");
    const nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    delete nodeEnv.NODE_PATH;
    run(executable, ["-e", "require('tsx/cjs'); require('./src/main/agent-runner.ts'); console.log('[package] core loader ready'); process.exit(0)"], { cwd: appRes, env: nodeEnv, timeout: 30_000, killSignal: "SIGKILL" });
    run(executable, ["-e", "const {spawnSync}=require('node:child_process'); const r=spawnSync(require('@vscode/ripgrep').rgPath,['--version'],{stdio:'inherit'}); process.exit(r.status??1)"], { cwd: appRes, env: nodeEnv });

    const workspace = mkdtempSync(join(tmpdir(), "cairn-package-smoke-"));
    const smokeEnv = { ...process.env, CAIRN_SMOKE: "1", CAIRN_DESKTOP_WORKSPACE: workspace };
    for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_PATH", "VITE_DEV_SERVER_URL", "M0A_PROVIDER", "M3A_MAIN_SCRIPT"]) delete smokeEnv[key];
    const smoke = run(executable, PACKAGED_SMOKE_ARGS, { cwd: workspace, env: smokeEnv, timeout: 45_000, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
    process.stdout.write(smoke.stdout);
    if (!packagedSmokePassed(smoke)) throw new Error("打包态进程退出但没有冒烟成功凭据；不生成已验证产物");
    rmSync(workspace, { recursive: true, force: true });

    if (options.archive) {
      const dmgPath = join(staging, "Cairn.dmg");
      // macOS 26 的 hdiutil 已废弃；本机实测 `hdiutil create` 返回「功能未实现」，
      // 旧脚本于是静默回退 zip，README 却还写着 Cairn.dmg。主路径改走 diskutil，
      // hdiutil 只作旧系统回退，两者都失败才退 zip（并明确出声）。
      // 安装盘里放 Applications 快捷方式：用户打开 DMG 就能把 Cairn.app 拖进去。
      const dmgRoot = join(staging, "dmg");
      mkdirSync(dmgRoot, { recursive: true });
      cpSync(appDir, join(dmgRoot, "Cairn.app"), { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      cpSync(join(repoRoot, "docs/macos-trial.md"), join(dmgRoot, "安装说明.md"));
      symlinkSync("/Applications", join(dmgRoot, "Applications"));
      let dmg = spawnSync("diskutil", ["image", "create", "from", "--format", "UDZO", "--volumeName", "Cairn", dmgRoot, dmgPath], { encoding: "utf8" });
      if (dmg.status !== 0) {
        dmg = spawnSync("hdiutil", ["create", "-volname", "Cairn", "-srcfolder", dmgRoot, "-ov", "-format", "udzo", dmgPath], { encoding: "utf8" });
      }
      if (dmg.status !== 0) {
        console.warn(`[package] DMG 创建失败（diskutil/hdiutil），回退 Cairn-macOS.zip：${String(dmg.stderr ?? "").trim()}`);
        run("ditto", ["-c", "-k", "--sequesterRsrc", dmgRoot, join(staging, "Cairn-macOS.zip")]);
      }
      // 包自己跑安装验收：挂 DMG -> 复制 app -> CAIRN_SMOKE；失败就不产出（不留「能打包但不能装」的包）。
      if (dmg.status === 0 && existsSync(dmgPath)) {
        run(process.execPath, [join(desktopDir, "scripts", "install-smoke.mjs"), dmgPath], { cwd: repoRoot, env: process.env, timeout: 90_000 });
      }
      // dmgRoot 是 staging 里的 568MB 克隆；不删就会随 rename 一起混进 release（实测 release-829 多出 dmg/）。
      rmSync(dmgRoot, { recursive: true, force: true });
    }
    cpSync(join(repoRoot, "docs/macos-trial.md"), join(staging, "安装说明.md"));
    writeFileSync(join(staging, "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n");
    if (occupied(options.out)) throw new Error(`目标已存在：${options.out}；保留已有产物`);
    renameSync(staging, options.out);
    console.log(`[package] 完成（已验证打包态）：${join(options.out, "Cairn.app")}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = optionsOf(process.argv.slice(2)); }
  catch (error) { console.error(`[package] ${error.message}`); process.exitCode = 2; }
  if (options?.help) console.log("Cairn macOS package: --out <new-directory> [--no-archive]\nBuilds, signs and smoke-tests the app before publishing; existing output is preserved.");
  else if (options) {
    try { packageDesktop(options); }
    catch (error) { console.error(`[package] FAIL: ${error.message}`); process.exitCode = 1; }
  }
}
