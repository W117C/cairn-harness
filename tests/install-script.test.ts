import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("install.sh package manager selection", () => {
  it("explains when the installed pnpm cannot start without silently switching package managers", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-install-test-"));
    tempDirs.push(dir);
    const calls = join(dir, "calls");
    symlinkSync(process.execPath, join(dir, "node"));
    writeFileSync(join(dir, "pnpm"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(join(dir, "npm"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CAIRN_INSTALL_TEST_CALLS"\n`, { mode: 0o755 });

    const result = spawnSync("/bin/bash", [resolve("scripts/install.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:/usr/bin:/bin`, CAIRN_INSTALL_TEST_CALLS: calls },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm 无法启动");
    expect(existsSync(calls)).toBe(false);
  });

  it("reports a failed pnpm install instead of retrying with npm", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-install-test-"));
    tempDirs.push(dir);
    symlinkSync(process.execPath, join(dir, "node"));
    writeFileSync(join(dir, "pnpm"), "#!/bin/sh\n[ \"$1\" = --version ] && exit 0\nexit 7\n", { mode: 0o755 });
    writeFileSync(join(dir, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const result = spawnSync("/bin/bash", [resolve("scripts/install.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
    });

    expect(result.status).toBe(7);
  });

  it("keeps the existing npm fallback when pnpm is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-install-test-"));
    tempDirs.push(dir);
    const calls = join(dir, "calls");
    symlinkSync(process.execPath, join(dir, "node"));
    writeFileSync(join(dir, "npm"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$CAIRN_INSTALL_TEST_CALLS\"\n", { mode: 0o755 });

    const result = spawnSync("/bin/bash", [resolve("scripts/install.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:/usr/bin:/bin`, CAIRN_INSTALL_TEST_CALLS: calls },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(calls, "utf8")).toBe("install\n");
    expect(result.stdout).toContain("npm 不使用 pnpm 锁文件");
  });
});
