import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cairn-package-test-"));
  temporaryRoots.push(root);
  const desktop = join(root, "apps/desktop");
  const binaries = join(root, "bin");
  for (const path of ["apps/desktop/scripts", "apps/desktop/runtime", "apps/desktop/src", "apps/desktop/dist", "apps/desktop/dist-electron", "apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS", "apps/desktop/node_modules/electron/dist/Electron.app/Contents/Resources", "src", "fixtures", "bin"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  cpSync(fileURLToPath(new URL("../scripts/package.mjs", import.meta.url)), join(desktop, "scripts/package.mjs"));
  writeFileSync(join(desktop, "runtime/package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { version: "0.1.0", dependencies: { tsx: "1" } } } }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.0", dependencies: {}, devDependencies: { tsx: "1" } }));
  writeFileSync(join(desktop, "node_modules/electron/package.json"), JSON.stringify({ version: "44.9.1" }));
  writeFileSync(join(desktop, "package.json"), "{}\n");
  writeFileSync(join(desktop, "node_modules/electron/dist/Electron.app/Contents/Info.plist"), '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict/></plist>');
  writeFileSync(join(desktop, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"), '#!/bin/sh\nprintf "%s\\n" "$CAIRN_SMOKE:$CAIRN_DESKTOP_WORKSPACE" >> "$CAIRN_TEST_SMOKE_LOG"\n[ "$CAIRN_TEST_SMOKE_RESULT" = fail ] && exit 1\n[ "$CAIRN_TEST_SMOKE_RESULT" = empty ] && exit 0\necho "[cairn-smoke] PASS in 1 ms"\n', { mode: 0o755 });
  for (const command of ["pnpm", "npm"]) writeFileSync(join(binaries, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(binaries, "npm"), `#!/bin/sh
[ "$1" = ci ] || exit 32
[ -f package-lock.json ] || exit 33
`, { mode: 0o755 });
  writeFileSync(join(binaries, "codesign"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CAIRN_TEST_CODESIGN_LOG"\n[ "$1" = --verify ] && [ "$CAIRN_TEST_CODESIGN_FAIL" = 1 ] && exit 1\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(binaries, "ditto"), '#!/bin/sh\nif [ "$1" = -c ]; then for arg do last="$arg"; done; printf archive > "$last"; else cp -R "$1" "$2"; fi\n', { mode: 0o755 });
  writeFileSync(join(binaries, "hdiutil"), '#!/bin/sh\n[ "$CAIRN_TEST_DMG_FAIL" = missing ] && exit 0\nfor arg do last="$arg"; done\nprintf archive > "$last"\n[ "$CAIRN_TEST_DMG_FAIL" = 1 ] && exit 1\nexit 0\n', { mode: 0o755 });
  return { root, desktop, binaries, log: join(root, "smoke.log"), signLog: join(root, "codesign.log") };
}

function runPackage(f: ReturnType<typeof fixture>, smokeResult = "pass", dmgMode = "0", signFails = false) {
  return spawnSync(process.execPath, [join(f.desktop, "scripts/package.mjs")], {
    cwd: f.root,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, PATH: `${f.binaries}:${process.env.PATH}`, CAIRN_TEST_SMOKE_RESULT: smokeResult, CAIRN_TEST_SMOKE_LOG: f.log, CAIRN_TEST_DMG_FAIL: dmgMode, CAIRN_TEST_CODESIGN_LOG: f.signLog, CAIRN_TEST_CODESIGN_FAIL: signFails ? "1" : "0" },
  });
}

describe.skipIf(process.platform !== "darwin")("desktop package safety", () => {

  it.each(["0", "1"])("records archive integrity and installed dependency identity for DMG mode %s", (mode) => {
    const f = fixture();
    const result = runPackage(f, "pass", mode);
    expect(result.status, result.stderr).toBe(0);
    const release = join(f.desktop, "release");
    const archive = mode === "0" ? "Cairn.dmg" : "Cairn-macOS.zip";
    const digest = createHash("sha256").update(readFileSync(join(release, archive))).digest("hex");
    const manifest = JSON.parse(readFileSync(join(release, "release.json"), "utf8"));
    expect(manifest).toMatchObject({ version: "0.1.0", buildHost: { platform: process.platform, arch: process.arch },
      electron: "44.9.1", signing: "ad-hoc", notarized: false,
      archive: { name: archive, sha256: digest, bytes: 7 } });
    const runtime = join(release, "Cairn.app/Contents/Resources/app");
    expect(JSON.parse(readFileSync(join(runtime, "package.json"), "utf8")).version).toBe("0.1.0");
    expect(manifest.runtimeLockSha256).toBe(createHash("sha256").update(readFileSync(join(runtime, "package-lock.json"))).digest("hex"));
    const checksums = readFileSync(join(release, "SHA256SUMS"), "utf8");
    expect(checksums).toContain(`${digest}  ${archive}\n`);
    expect(checksums).toContain(`${createHash("sha256").update(readFileSync(join(release, "release.json"))).digest("hex")}  release.json\n`);
  });

  it("fails before publication when npm produces no dependency lock", () => {
    const f = fixture();
    writeFileSync(join(f.binaries, "npm"), "#!/bin/sh\nrm -f package-lock.json\nexit 0\n", { mode: 0o755 });
    const result = runPackage(f);
    expect(result.status).not.toBe(0);
    expect(existsSync(join(f.desktop, "release"))).toBe(false);
  });

  it("rejects changed runtime dependency declarations until the lock is refreshed", () => {
    const f = fixture();
    writeFileSync(join(f.root, "package.json"), JSON.stringify({ version: "0.1.0", dependencies: {}, devDependencies: { tsx: "2" } }));
    const result = runPackage(f);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("运行依赖锁与声明不一致");
    expect(existsSync(join(f.desktop, "release"))).toBe(false);
  });

  it("keeps an existing release directory and fails", () => {
    const f = fixture();
    const release = join(f.desktop, "release");
    mkdirSync(release);
    writeFileSync(join(release, "keep.txt"), "previous package");
    const result = runPackage(f);
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(release, "keep.txt"), "utf8")).toBe("previous package");
  });

  it.each(["fail", "empty"])("rejects a packaged smoke result of %s without publishing", (smokeResult) => {
    const f = fixture();
    const result = runPackage(f, smokeResult);
    expect(result.status).not.toBe(0);
    expect(readFileSync(f.log, "utf8")).toMatch(/^1:\/.*cairn-package-smoke-/);
    expect(existsSync(join(f.desktop, "release"))).toBe(false);
  });

  it("publishes the existing app and DMG outputs after a successful packaged smoke", () => {
    const f = fixture();
    const result = runPackage(f);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(f.log, "utf8")).toMatch(/^1:\/.*cairn-package-smoke-/);
    expect(existsSync(join(f.desktop, "release/Cairn.app/Contents/MacOS/Cairn"))).toBe(true);
    expect(existsSync(join(f.desktop, "release/Cairn.dmg"))).toBe(true);
  });

  it("preserves the ZIP fallback after a successful packaged smoke", () => {
    const f = fixture();
    const result = runPackage(f, "pass", "1");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(f.log, "utf8")).toMatch(/^1:\/.*cairn-package-smoke-/);
    expect(existsSync(join(f.desktop, "release/Cairn-macOS.zip"))).toBe(true);
    expect(existsSync(join(f.desktop, "release/Cairn.dmg"))).toBe(false);
  });

  it("preserves files another process adds to the reserved output directory", () => {
    const f = fixture();
    writeFileSync(join(f.binaries, "pnpm"), `#!/bin/sh\nprintf '%s' 'other process' > '${join(f.desktop, "release/other.txt")}'\nexit 1\n`, { mode: 0o755 });
    const result = runPackage(f);
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(f.desktop, "release/other.txt"), "utf8")).toBe("other process");
  });

  it("rejects a successful archive command that produced no DMG", () => {
    const f = fixture();
    const result = runPackage(f, "pass", "missing");
    expect(result.status).not.toBe(0);
    expect(existsSync(join(f.desktop, "release"))).toBe(false);
  });

  it("rejects a package whose code signature fails strict verification", () => {
    const f = fixture();
    const result = runPackage(f, "pass", "0", true);
    expect(result.status).not.toBe(0);
    expect(readFileSync(f.signLog, "utf8")).toContain("--verify --deep --strict");
    expect(existsSync(join(f.desktop, "release"))).toBe(false);
  });

  it("signs nested bundles before their parent and verifies the app", () => {
    const f = fixture();
    mkdirSync(join(f.desktop, "node_modules/electron/dist/Electron.app/Contents/Frameworks/Helper.app/Contents/Frameworks/Nested.framework"), { recursive: true });
    const result = runPackage(f);
    expect(result.status, result.stderr).toBe(0);
    const lines = readFileSync(f.signLog, "utf8").trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Nested.framework");
    expect(lines[1]).toContain("Helper.app");
    expect(lines[2]).toContain("Cairn.app");
    expect(lines[3]).toContain("--verify --deep --strict");
  });
});
