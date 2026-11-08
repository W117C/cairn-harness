import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("apps/desktop/scripts/package.mjs");
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
const env = { ...process.env, PATH: "" }; // A parser/metadata test must never start a build or install.

describe("desktop package command", () => {
  it("help is available without a build toolchain", () => {
    const releaseExisted = existsSync(resolve("apps/desktop/release"));
    const result = spawnSync(process.execPath, [script, "--help"], { env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("--out");
    expect(result.stdout).toContain("--no-archive");
    expect(existsSync(resolve("apps/desktop/release"))).toBe(releaseExisted);
  });

  it("rejects an existing output directory before running build tools", () => {
    const out = mkdtempSync(join(tmpdir(), "cairn-existing-package-"));
    temporary.push(out);
    writeFileSync(join(out, "keep.txt"), "previous release");
    const result = spawnSync(process.execPath, [script, "--out", out], { env, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("目标已存在");
    expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("previous release");
  });

  it.each([{ args: ["--unknown"] }, { args: ["--out"] }])("rejects invalid arguments before doing work: $args", ({ args }) => {
    const result = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(2);
  });

  it("runtime identity retains the product version and module type without development dependencies", () => {
    const code = `import { readFileSync } from 'node:fs'; import { makeRuntimePackage } from ${JSON.stringify(pathToFileURL(script).href)}; process.stdout.write(JSON.stringify(makeRuntimePackage(JSON.parse(readFileSync(0, 'utf8')))));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      env, encoding: "utf8", input: JSON.stringify({
        name: "fixture-source", version: "2.3.4", type: "module",
        dependencies: { "runtime-fixture": "1.2.3", tsx: "4.23.13" },
        devDependencies: { vitest: "5.0.0", typescript: "5.9.3" },
      }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      name: "cairn", version: "2.3.4", type: "module", private: true,
      main: "apps/desktop/src/main/entry.cjs",
      dependencies: { "runtime-fixture": "1.2.3", tsx: "4.23.13" },
    });
  });

  it.skipIf(process.platform === "win32")("signs nested code before its enclosing bundle without following framework aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "cairn-sign-order-"));
    temporary.push(root);
    const app = join(root, "Product.app");
    const framework = join(app, "Contents/Frameworks/Outer.framework");
    const nested = join(framework, "Versions/A/Nested.app");
    mkdirSync(nested, { recursive: true });
    symlinkSync("A", join(framework, "Versions/Current"));
    const code = `import { codeSigningTargets } from ${JSON.stringify(pathToFileURL(script).href)}; process.stdout.write(JSON.stringify(codeSigningTargets(process.argv[1])));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, app], { env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([nested, framework, app]);
  });

  it.each([
    { status: 0, stdout: "", expected: false },
    { status: 0, stdout: "PASS", expected: false },
    { status: 0, stdout: "[cairn-smoke] PASS in 12 ms\n", expected: true },
    { status: 0, stdout: "[cairn-smoke] PASS in 12 ms\n", signal: "SIGTERM", expected: false },
    { status: 0, stdout: "[cairn-smoke] PASS in 12 ms\n", error: { code: "ETIMEDOUT" }, expected: false },
    { status: 1, stdout: "[cairn-smoke] PASS in 12 ms\n", expected: false },
  ])("requires a successful smoke receipt: $status/$stdout/$signal", row => {
    const code = `import { packagedSmokePassed } from ${JSON.stringify(pathToFileURL(script).href)}; process.stdout.write(JSON.stringify(packagedSmokePassed(JSON.parse(process.argv[1]))));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, JSON.stringify(row)], { env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toBe(row.expected);
  });

  it("packaged smoke isolates the real keychain after an ad-hoc re-sign", () => {
    const code = `import { PACKAGED_SMOKE_ARGS } from ${JSON.stringify(pathToFileURL(script).href)}; process.stdout.write(JSON.stringify(PACKAGED_SMOKE_ARGS));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["--use-mock-keychain"]);
    expect(readFileSync(script, "utf8")).toContain("run(executable, PACKAGED_SMOKE_ARGS");
  });

  it("removes machine state while preserving declared fixture configuration and production modules", () => {
    const root = mkdtempSync(join(tmpdir(), "cairn-package-state-"));
    temporary.push(root);
    const files = {
      "fixtures/app/.agent/config.json": '{"verify":{"test":["fixture-test"]}}',
      "fixtures/app/.agent/sessions/private.jsonl": "private session",
      "fixtures/app/.agent/snapshots/private.txt": "private snapshot",
      "apps/desktop/src/renderer/.mimosa/report.md": "private report",
      "src/main/service.ts": "export const available = true;",
      "node_modules/required/index.js": "module.exports = true;",
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const code = `import { pruneRuntimeState } from ${JSON.stringify(pathToFileURL(script).href)}; pruneRuntimeState(process.argv[1], new Set(['fixtures/app/.agent/config.json']));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, root], { env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, "fixtures/app/.agent/config.json"), "utf8")).toBe(files["fixtures/app/.agent/config.json"]);
    expect(existsSync(join(root, "fixtures/app/.agent/sessions/private.jsonl"))).toBe(false);
    expect(existsSync(join(root, "fixtures/app/.agent/snapshots/private.txt"))).toBe(false);
    expect(existsSync(join(root, "apps/desktop/src/renderer/.mimosa"))).toBe(false);
    expect(existsSync(join(root, "src/main/service.ts"))).toBe(true);
    expect(existsSync(join(root, "node_modules/required/index.js"))).toBe(true);
  });
  it("DMG 主路径走 diskutil（hdiutil 只回退，zip 最后兜底）", () => {
    const pkg = readFileSync(script, "utf8");
    expect(pkg).toContain('"diskutil"');
    expect(pkg).toContain('"image", "create", "from"');
    expect(pkg).toContain('"hdiutil"');
    expect(pkg).toContain('"Cairn-macOS.zip"');
    expect(pkg).toContain('symlinkSync("/Applications"');
    expect(pkg).toContain('join(dmgRoot, "Applications")');
    expect(pkg).toContain('rmSync(dmgRoot');
    expect(pkg).toContain('install-smoke.mjs');
  });

  it("安装盘验收脚本存在：挂载 DMG、复制 app、跑 CAIRN_SMOKE", () => {
    const install = readFileSync(resolve("apps/desktop/scripts/install-smoke.mjs"), "utf8");
    expect(install).toContain('"diskutil", ["image", "attach"');
    expect(install).toContain("Applications");
    expect(install).toContain("CAIRN_SMOKE: \"1\"");
    expect(install).toContain("[cairn-smoke] PASS");
  });

});
