import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { read_file } from "../src/tools/read_file";
import type { ToolContext } from "../src/tools";

let ws = "";
afterEach(async () => { if (ws) await rm(ws, { recursive: true, force: true }); });

async function newCtx(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "m2a-read-"));
  return { workspace: ws };
}

describe("read_file 整形（M2a 任务 3）", () => {
  it("offset/limit（1-based）：读取指定行段并附总行数提示", async () => {
    const ctx = await newCtx();
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) lines.push("line-" + String(i));
    await writeFile(join(ws, "f.txt"), lines.join("\n") + "\n", "utf8");
    const res = await read_file.run({ path: "f.txt", offset: 10, limit: 5 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output.split("\n")[0]).toBe("line-10");
    expect(res.output.split("\n")[4]).toBe("line-14");
    expect(res.output).toContain("从第 10 行起共 50 行，仅显示 5 行");
  });

  it("默认 2000 行上限：2500 行文件只显示 2000 行 + 提示", async () => {
    const ctx = await newCtx();
    const lines: string[] = [];
    for (let i = 1; i <= 2500; i++) lines.push("row " + String(i));
    await writeFile(join(ws, "big.txt"), lines.join("\n") + "\n", "utf8");
    const res = await read_file.run({ path: "big.txt" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output.split("\n").filter((l) => l.startsWith("row ")).length).toBe(2000);
    expect(res.output).toContain("仅显示 2000 行");
    expect(res.output).toContain("offset/limit");
  });

  it("单行超 2000 字符截断并带提示", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "long.txt"), "y".repeat(3000) + "\n", "utf8");
    const res = await read_file.run({ path: "long.txt" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output.split("\n")[0].length).toBe(2000 + " …[行截断]".length);
    expect(res.output).toContain("行截断");
  });

  it("总量 50KB 上限：超限截断 + 提示（字节截断不炸坏字符）", async () => {
    const ctx = await newCtx();
    // 每行 90 字符 × 1000 行 ≈ 90KB（行数低于 2000，行截断不触发，触发总字节上限）
    const line = "z".repeat(89);
    await writeFile(join(ws, "fat.txt"), (line + "\n").repeat(1000), "utf8");
    const res = await read_file.run({ path: "fat.txt" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("已截断");
    expect(Buffer.byteLength(res.output, "utf8")).toBeLessThanOrEqual(50 * 1024 + 200);
  });

  it("二进制嗅探：NUL 文件拒读；>30% 不可打印拒读", async () => {
    const ctx = await newCtx();
    const { writeFile: wb } = await import("node:fs/promises");
    const buf1 = Buffer.from([0x68, 0x65, 0x00, 0x6c, 0x6f]); // 含 NUL
    await wb(join(ws, "bin1.bin"), buf1);
    await expect(read_file.run({ path: "bin1.bin" }, ctx)).rejects.toThrow(/二进制/);
    // 30 字节里 12 个 0x01（不可打印）= 40%
    const buf2 = Buffer.concat([Buffer.alloc(12, 0x01), Buffer.alloc(18, 0x41)]);
    await wb(join(ws, "bin2.bin"), buf2);
    await expect(read_file.run({ path: "bin2.bin" }, ctx)).rejects.toThrow(/二进制/);
  });

  it("文件不存在：报错附最多 3 个近名建议", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "todo-helper.ts"), "export {}", "utf8");
    await writeFile(join(ws, "src", "todo-utils.ts"), "export {}", "utf8");
    await writeFile(join(ws, "src", "todo-helper.test.ts"), "export {}", "utf8");
    await writeFile(join(ws, "src", "unrelated.ts"), "export {}", "utf8");
    const err = await read_file.run({ path: "src/todo-helperx.ts" }, ctx).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("文件不存在");
    expect(msg).toContain("todo-helper.ts");
    const suggestions = (msg.match(/近名建议: (.*)/) ?? [])[1]?.split(", ") ?? [];
    expect(suggestions.length).toBe(3);
    expect(suggestions.length).toBe(new Set(suggestions).size);
  });

  it("目录路径：列条目（带 / 后缀）", async () => {
    const ctx = await newCtx();
    await mkdir(join(ws, "sub", "inner"), { recursive: true });
    await writeFile(join(ws, "sub", "a.txt"), "x", "utf8");
    await writeFile(join(ws, "sub", "b.txt"), "x", "utf8");
    const res = await read_file.run({ path: "sub" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("sub/（目录，3 项）");
    expect(res.output).toContain("a.txt/");
    expect(res.output).toContain("inner/");
  });

  it("正常文本读取行为不变（M0 回归）", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.txt"), "hello cairn", "utf8");
    const res = await read_file.run({ path: "a.txt" }, ctx);
    expect(res.output).toBe("hello cairn");
  });
});
