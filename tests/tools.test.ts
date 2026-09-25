import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { read_file } from "../src/tools/read_file";
import { edit_file } from "../src/tools/edit_file";
import { run_shell } from "../src/tools/run_shell";
import { write_file } from "../src/tools/write_file";
import type { ToolContext } from "../src/tools";

let ws = "";
afterEach(async () => { if (ws) await rm(ws, { recursive: true, force: true }); });

async function newCtx(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "m0-tools-"));
  return { workspace: ws };
}

describe("read_file", () => {
  it("正常：读回文件内容", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.txt"), "hello m0", "utf8");
    const res = await read_file.run({ path: "a.txt" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toBe("hello m0");
  });

  it("超限：50KB 上限截断并附一行提示（M2a 起行截断 2000 先接管单行超长）", async () => {
    const ctx = await newCtx();
    // M2a 规格两层：单行 >2000 字符由行截断处理（输出 <50KB，不再触发字节截断）
    await writeFile(join(ws, "long-line.txt"), "y".repeat(60_000), "utf8");
    const resLine = await read_file.run({ path: "long-line.txt" }, ctx);
    expect(resLine.ok).toBe(true);
    expect(resLine.output).toContain("行截断");
    expect(resLine.output.startsWith("y")).toBe(true);
    expect(Buffer.byteLength(resLine.output, "utf8")).toBeLessThanOrEqual(3_000);
    // 多行（行数 ≤2000）但总字节 >50KB → 仍由 50KB 字节上限截断 + 提示
    const line = "z".repeat(89);
    await writeFile(join(ws, "big.txt"), (line + "\n").repeat(1000), "utf8");
    const res = await read_file.run({ path: "big.txt" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("已截断");
    expect(res.output.startsWith("z")).toBe(true);
    // 帽管的是**正文**，提示行在帽之外（这一口径不是新规矩，#57 只是把开销如实写出来）：
    // 旧提示一句 ~50 字节、新提示带省略量与续读 offset ~160 字节 ⇒ 断言分两截写，余量按实测给，不放大魔数蒙。
    const body = res.output.slice(0, res.output.indexOf("\n[truncated:"));
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(50 * 1024);
    expect(Buffer.byteLength(res.output, "utf8") - Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(400);
  });

  it("错误路径：不存在 / 绝对路径都被拒", async () => {
    const ctx = await newCtx();
    await expect(read_file.run({ path: "missing.txt" }, ctx)).rejects.toThrow(/文件不存在/);
    await expect(read_file.run({ path: "/etc/passwd" }, ctx)).rejects.toThrow(/绝对路径/);
  });
});

describe("write_file", () => {
  it("正常：写入并可读回，输出带 workspace 相对路径", async () => {
    const ctx = await newCtx();
    const res = await write_file.run({ path: "src/nested/b.txt", content: "data-1" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("src/nested/b.txt");
    expect(await readFile(join(ws, "src/nested/b.txt"), "utf8")).toBe("data-1");
  });

  it("新建 → 覆盖 → 编辑：三步之后文件内容逐字正确", async () => {
    const ctx = await newCtx();
    const created = await write_file.run({ path: "new.txt", content: "one" }, ctx);
    expect(created.ok).toBe(true);
    const overwritten = await write_file.run({ path: "new.txt", content: "two" }, ctx);
    expect(overwritten.ok).toBe(true);
    const edited = await edit_file.run({ path: "new.txt", old_string: "two", new_string: "three" }, ctx);
    expect(edited.ok).toBe(true);
    expect(await readFile(join(ws, "new.txt"), "utf8")).toBe("three");
  });

  it("超限：内容超过 50KB 拒绝写入（截断写入会损坏数据）", async () => {
    const ctx = await newCtx();
    await expect(
      write_file.run({ path: "big.txt", content: "z".repeat(60_000) }, ctx),
    ).rejects.toThrow(/超过 50KB 上限/);
    await expect(readFile(join(ws, "big.txt"), "utf8")).rejects.toThrow(); // 文件不应被创建
  });

  it("错误路径：越出 workspace 边界被拒", async () => {
    const ctx = await newCtx();
    await expect(write_file.run({ path: "../evil.txt", content: "x" }, ctx)).rejects.toThrow(/越出 workspace 边界/);
  });
});

describe("run_shell", () => {
  it("正常：在指定 workspace 下执行并回传输出", async () => {
    const ctx = await newCtx();
    const res = await run_shell.run({ command: "pwd && echo hello-m0" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("hello-m0");
    expect(res.output).toBe((await realpath(ws)) + "\nhello-m0"); // 只在该 workspace 下执行（realpath 对齐 macOS /var 符号链接）
  });

  it("超限：输出超过 32KB 截断并附一行提示", async () => {
    const ctx = await newCtx();
    const res = await run_shell.run(
      { command: `node -e "process.stdout.write('x'.repeat(40000))"` },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.output).toContain("已截断");
    expect(Buffer.byteLength(res.output, "utf8")).toBeLessThanOrEqual(32 * 1024 + 100);
  });

  it("错误路径：非零退出码 → ok:false 且保留输出", async () => {
    const ctx = await newCtx();
    const res = await run_shell.run({ command: "echo boom >&2; exit 3" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("boom");
    expect(res.output).toContain("exit code: 3");
  });
});