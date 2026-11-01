// 第 948 页：清理临时目录不许因为「子进程还在写」把一条绿判据变红。
// 现场：`terminal-login-shell.test.ts` 用隔离 HOME 起登录 shell，afterEach 裸 `rmSync` 撞上
// shell 还在写 `.zcompdump` ⇒ ENOTEMPTY ⇒ 判据红（实测桌面套件首跑一次，单跑/重跑都绿）。
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { removeTempDir } from "./helpers/temp-dir";

describe("临时目录清理（第 948 页）", () => {
  it("子进程还在往目录里写时，清理不抛（重试 + 咽下）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-cleanup-"));
    // 模拟登录 shell 的收尾写入：持续造文件，直到被杀。
    const child = spawn("/bin/sh", ["-c", `i=0; while [ $i -lt 400 ]; do : > ${dir}/f$i; i=$((i+1)); done`], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 20));
    expect(() => { removeTempDir(dir); }).not.toThrow();
    child.kill("SIGKILL");
  });

  it("目录不存在也不抛（幂等）", () => {
    expect(() => { removeTempDir(join(tmpdir(), "cairn-cleanup-not-exist-" + String(Date.now()))); }).not.toThrow();
  });

  it("正常目录会被真的删掉（不是一律不删）", async () => {
    const { existsSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "cairn-cleanup-ok-"));
    writeFileSync(join(dir, "a.txt"), "x");
    removeTempDir(dir);
    expect(existsSync(dir)).toBe(false);
  });
});
