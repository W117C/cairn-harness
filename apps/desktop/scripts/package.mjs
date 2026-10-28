// Keep the source layout intact: the core's import.meta/fixture paths must survive packaging.
// pnpm deploy supplies a locked, isolated production dependency tree; no second npm resolution.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  mkdirSync(dirname(options.out), { recursive: true });
  const staging = mkdtempSync(join(dirname(options.out), ".cairn-package-"));
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
      const dmg = spawnSync("hdiutil", ["create", "-volname", "Cairn", "-srcfolder", appDir, "-ov", "-format", "udzo", join(staging, "Cairn.dmg")]);
      if (dmg.status !== 0) run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appDir, join(staging, "Cairn-macOS.zip")]);
    }
    writeFileSync(join(staging, "build-info.json"), JSON.stringify({
      version: source.version, platform: process.platform, arch: process.arch,
      sourceLockSha256: createHash("sha256").update(readFileSync(join(repoRoot, "pnpm-lock.yaml"))).digest("hex"),
      packagedSmoke: "passed", signature: "ad-hoc", createdAt: new Date().toISOString(),
    }, null, 2) + "\n");
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
