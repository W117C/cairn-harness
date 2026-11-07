// 第三批小件（calc / list_dir）判卷面：
//  ① calc：优先级/右结合幂/一元负号/括号/pi-e/浮点伪影清理；除零·未知字符·悬空运算符显式报错；
//     语法面显式枚举——函数调用/变量/十六进制一律拒（确定性工具不接受模糊输入）。
//  ② list_dir：类型/大小/时间列、空目录与不存在/是文件三种阴性各说清、越界拒、200 条截断。
//  ③ worker 面：git_read 进了 worker 两张表与规格面，calc/list_dir 不进（worker 不需要算术面）。
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calc, tokenize } from "../src/tools/calc";
import { list_dir } from "../src/tools/list_dir";
import { ToolError } from "../src/tools";
import { workerToolSpecs } from "../src/agent/worker-shell-tools";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const ctx = (dir: string) => ({ workspace: dir });

describe("calc", () => {
  const run = (expression: string): Promise<string> => calc.run({ expression }, { workspace: "/w" }).then((r) => r.output);

  it("四则与优先级、括号、一元负号", async () => {
    expect(await run("1 + 2 * 3")).toBe("1 + 2 * 3 = 7");
    expect(await run("(1 + 2) * 3")).toBe("(1 + 2) * 3 = 9");
    expect(await run("-3 + 5")).toBe("-3 + 5 = 2");
    expect(await run("2 * -3")).toBe("2 * -3 = -6");
  });

  it("幂右结合；pi/e 常量；模", async () => {
    expect(await run("2 ** 3 ** 2")).toBe("2 ** 3 ** 2 = 512");
    expect(await run("10 % 3")).toBe("10 % 3 = 1");
    expect(await run("pi * 2")).toContain(String(Number((Math.PI * 2).toPrecision(12))));
    expect(await run("e * 1")).toContain("2.71828182846");
  });

  it("浮点伪影清到 12 位有效数字：0.1 + 0.2 = 0.3", async () => {
    expect(await run("0.1 + 0.2")).toBe("0.1 + 0.2 = 0.3");
  });

  it("除零/模零显式报错，不给 Infinity", async () => {
    await expect(run("1 / 0")).rejects.toThrow(/除以零/);
    await expect(run("1 % 0")).rejects.toThrow(/模零/);
  });

  it("语法面显式枚举：函数调用/变量/十六进制/悬空运算符一律拒", async () => {
    await expect(run("sqrt(4)")).rejects.toBeInstanceOf(ToolError);
    await expect(run("2 * x")).rejects.toBeInstanceOf(ToolError);
    await expect(run("0xff")).rejects.toBeInstanceOf(ToolError);
    await expect(run("1 +")).rejects.toBeInstanceOf(ToolError);
    await expect(run("(1 + 2")).rejects.toBeInstanceOf(ToolError);
  });

  it("tokenize：不认识的字符当场点名（承诺面证人）", () => {
    // 「不认识的字符」这句承诺住在 tokenize 的错误分支（不吞进解析器报含糊的语法错误）——
    // 证人直接钉函数本体（2026-11-07 承诺清单账，台账第 1040 页）。
    expect(() => tokenize("2 & 3")).toThrow(/不认识的字符「&」/);
  });
});

describe("list_dir", () => {
  it("列出类型/大小/时间；目录带 /；mtime 真实反映", async () => {
    const dir = await mkdtemp(join(tmpdir(), "list-dir-"));
    dirs.push(dir);
    await writeFile(join(dir, "a.txt"), "hello");
    await mkdir(join(dir, "sub"));
    const past = new Date("2026-01-01T00:00:00Z");
    await utimes(join(dir, "a.txt"), past, past);
    const r = await list_dir.run({}, ctx(dir));
    expect(r.ok).toBe(true);
    expect(r.output).toContain("sub/");
    expect(r.output).toContain("a.txt\t5B\t2026-01-01 00:00");
    expect(r.output).toContain("2 项");
  });

  it("空目录阴性说清；不存在/是文件各有可行动文案", async () => {
    const dir = await mkdtemp(join(tmpdir(), "list-dir-"));
    dirs.push(dir);
    await mkdir(join(dir, "empty"));
    const empty = await list_dir.run({ path: "empty" }, ctx(dir));
    expect(empty.output).toContain("空目录");
    await expect(list_dir.run({ path: "nope" }, ctx(dir))).rejects.toThrow(/目录不存在/);
    await writeFile(join(dir, "f.txt"), "x");
    await expect(list_dir.run({ path: "f.txt" }, ctx(dir))).rejects.toThrow(/是文件不是目录/);
  });

  it("越界路径拒；>200 条截断且出声", async () => {
    const dir = await mkdtemp(join(tmpdir(), "list-dir-"));
    dirs.push(dir);
    await expect(list_dir.run({ path: "../outside" }, ctx(dir))).rejects.toBeInstanceOf(ToolError);
    await mkdir(join(dir, "many"));
    for (let i = 0; i < 201; i++) await writeFile(join(dir, "many", "f" + String(i).padStart(3, "0")), "x");
    const r = await list_dir.run({ path: "many" }, ctx(dir));
    expect(r.output).toContain("截断到 200");
    expect(r.output).toContain("1 项未列出");
  });
});

describe("worker 面同源", () => {
  it("git_read 进 worker 两档规格；calc/list_dir 不进（worker 不需要）", () => {
    for (const mode of ["read", "write"] as const) {
      const names = workerToolSpecs(mode).map((s) => s.function.name);
      expect(names).toContain("git_read");
      expect(names).not.toContain("calc");
      expect(names).not.toContain("list_dir");
    }
  });
});
