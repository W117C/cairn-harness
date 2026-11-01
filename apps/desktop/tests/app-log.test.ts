// 主进程落盘日志判卷（2026-10-30 · 第 800 页）：
//   · 一行一条的格式与级别；
//   · 按大小轮转、只留 keep 份；
//   · console 分流不吞原输出；
//   · **写日志失败不许影响产品**（目录不可写时 write 不抛）。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppLog, formatAppLogLine, formatLogArgument, teeConsole } from "../src/main/app-log";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-app-log-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("日志行格式", () => {
  it("ISO 时间（含毫秒）+ 级别 + 正文，一行一条", () => {
    expect(formatAppLogLine(new Date("2026-10-30T04:00:00.123Z"), "error", "boom"))
      .toBe("2026-10-30T04:00:00.123Z [error] boom\n");
  });

  it("参数折行：字符串原样、Error 取 stack、循环引用不抛", () => {
    expect(formatLogArgument("plain")).toBe("plain");
    expect(formatLogArgument(new Error("bad"))).toContain("Error: bad");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatLogArgument(cyclic)).toBe("[object Object]");
  });
});

describe("写文件与轮转", () => {
  it("首次写入自动建目录并追加；注入时间让行可预期", () => {
    const dir = join(tempDir(), "logs");
    const log = createAppLog({ dir, now: () => new Date("2026-10-30T04:00:00.000Z") });
    log.write("info", "启动");
    log.write("warn", "注意");
    expect(log.file).toBe(join(dir, "main.log"));
    expect(readFileSync(log.file, "utf8")).toBe(
      "2026-10-30T04:00:00.000Z [info] 启动\n2026-10-30T04:00:00.000Z [warn] 注意\n",
    );
  });

  it("超过上限才轮转：旧内容进 main.1.log，当前文件只留轮转后的行", () => {
    const dir = tempDir();
    const log = createAppLog({ dir, maxBytes: 100, keep: 2 });
    log.write("info", "first-line-aaaaaaaaaaaaaaaa");
    log.write("info", "second-line-bbbbbbbbbbbbbbb");
    log.write("info", "third-line-ccccccccccccccc");
    const current = readFileSync(join(dir, "main.log"), "utf8");
    const previous = readFileSync(join(dir, "main.1.log"), "utf8");
    expect(current).toContain("third-line");
    expect(previous).toContain("first-line");
    expect(previous).toContain("second-line");
    expect(existsSync(join(dir, "main.2.log"))).toBe(false);
  });

  it("目录不可写（路径被文件占住）时 write 不抛——日志失败不拖垮主进程", () => {
    const dir = tempDir();
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "x");
    const log = createAppLog({ dir: blocker });
    expect(() => { log.write("error", "写不进去也不能炸"); }).not.toThrow();
  });
});

describe("console 分流", () => {
  it("四个级别都落文件，原 console 输出照常保留", () => {
    const dir = tempDir();
    const log = createAppLog({ dir, now: () => new Date("2026-10-30T04:00:00.000Z") });
    const fake = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const originals = { log: fake.log, info: fake.info, warn: fake.warn, error: fake.error };
    teeConsole(log, fake);
    fake.log("a", 1);
    fake.info("b");
    fake.warn("c");
    fake.error("d");
    // tee 会把方法换成分流器，原 spy 仍应各收到一次（原输出不许被吞）。
    expect(originals.log).toHaveBeenCalledWith("a", 1);
    expect(originals.info).toHaveBeenCalledWith("b");
    expect(originals.warn).toHaveBeenCalledWith("c");
    expect(originals.error).toHaveBeenCalledWith("d");
    const text = readFileSync(log.file, "utf8");
    expect(text).toContain("[info] a 1");
    expect(text).toContain("[info] b");
    expect(text).toContain("[warn] c");
    expect(text).toContain("[error] d");
  });
});

describe("主进程接线见证", () => {
  const appSource = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");

  it("日志在 userData 定下来之后建、console 已分流、未捕获异常有落点", () => {
    expect(appSource).toContain('createAppLog({ dir: join(userData, "logs") })');
    expect(appSource).toContain("teeConsole(appLog)");
    expect(appSource).toContain('process.on("uncaughtExceptionMonitor"');
    // 渲染层的 console 错误也进同一份日志（打包态没有 devtools 时唯一现场）。
    expect(appSource).toContain('appLog.write("error", `[renderer]');
  });

  it("「帮助 → 打开日志文件夹」直接开壳，不经渲染层", () => {
    expect(appSource).toContain('openLogs: () => { void shell.openPath(join(userData, "logs")); }');
  });
});
