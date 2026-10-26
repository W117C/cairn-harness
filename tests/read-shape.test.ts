import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { read_file, readRegularFilePrefix } from "../src/tools/read_file";
import type { ToolContext } from "../src/tools";
import { gateToolSpecs } from "../src/agent/session-provider";

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

  it("fstat 后小文件增长仍只做有界前缀读取，并明确报告文件已变化", async () => {
    const data = Buffer.from("growth witness");
    let requested = 0;
    const fake = {
      async read(target: Buffer, offset: number, length: number): Promise<{ bytesRead: number }> {
        requested = Math.max(requested, target.length);
        const n = Math.min(length, data.length);
        data.copy(target, offset, 0, n);
        return { bytesRead: n };
      },
    };
    const read = await readRegularFilePrefix(fake, 4);
    expect(requested, "分配上限必须由 fstat 大小得出，不能读成整文件").toBe(5);
    expect(read.grewDuringRead).toBe(true);
    expect(read.buf.toString("utf8")).toBe("grow");
  });
});

/* ── 第 477 页：一次多份（`paths`）。
   动因是一条真读数：`B12-long-horizon` 那趟 40 步里 41 次单份 read_file，请求 3–32 全是"一轮一支"
   （模型会并行——同一轮里发过 10 支），于是步数预算全花在读上，只剩 7 步改文件。 */
describe("read_file 一次多份（第 477 页）", () => {
  it("paths：一次交回多份，按数组顺序、每份带抬头", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.txt"), "AAA\n", "utf8");
    await writeFile(join(ws, "b.txt"), "BBB\n", "utf8");
    const res = await read_file.run({ paths: ["a.txt", "b.txt"] }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toBe("--- a.txt ---\nAAA\n--- b.txt ---\nBBB");
  });

  it("paths 里一份读不到**不拖红整批**：那一份原地出声，其余照交", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.txt"), "AAA\n", "utf8");
    const res = await read_file.run({ paths: ["a.txt", "nope.txt"] }, ctx);
    expect(res.ok, "还有一份真交回来了 ⇒ 这次调用不是失败").toBe(true);
    expect(res.output).toContain("--- a.txt ---\nAAA");
    expect(res.output).toContain("--- nope.txt ---\n[读取失败]");
  });

  it("多份全失败 ⇒ 这次调用判失败（工具失败面照旧真实，不许被批量洗成 ok）", async () => {
    const ctx = await newCtx();
    const res = await read_file.run({ paths: ["nope1.txt", "nope2.txt"] }, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("[读取失败]");
  });

  it("path 与 paths 同时给 ⇒ 拒绝（两条路读出来的东西不一样，不许静默选一条）", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.txt"), "AAA\n", "utf8");
    await expect(read_file.run({ path: "a.txt", paths: ["a.txt"] }, ctx)).rejects.toThrow(/只给一个/);
  });

  it("总额帽：塞不下的那一份**整份不交**并点名，且不交半份", async () => {
    const ctx = await newCtx();
    const rows = (tag: string) => Array.from({ length: 1200 }, (_, i) => tag + "-" + String(i).padStart(6, "0") + "-" + "y".repeat(12)).join("\n");
    await writeFile(join(ws, "big1.txt"), rows("first"), "utf8");
    await writeFile(join(ws, "big2.txt"), rows("second"), "utf8");
    const res = await read_file.run({ paths: ["big1.txt", "big2.txt"] }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output, "第一份要整份在里面").toContain("first-000000-");
    expect(res.output, "第二份越帽 ⇒ 一行都不许出现（半份会让人以为读全了）").not.toContain("second-");
    expect(res.output, "越帽的那一份必须**点名**，不是静默少算").toContain("本次没有交付");
    expect(res.output).toContain("big2.txt");
    expect(Buffer.byteLength(res.output, "utf8"), "总额帽就是 50KB 那道").toBeLessThanOrEqual(52 * 1024);
  });

  it("offset/limit 对每一份都生效（批量不是另一套读法）", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.txt"), "L1\nL2\nL3\nL4\n", "utf8");
    await writeFile(join(ws, "b.txt"), "M1\nM2\nM3\nM4\n", "utf8");
    const res = await read_file.run({ paths: ["a.txt", "b.txt"], offset: 2, limit: 2 }, ctx);
    expect(res.output).toContain("--- a.txt ---\nL2\nL3");
    expect(res.output).toContain("--- b.txt ---\nM2\nM3");
  });

  it("模型面把 paths 写进 read_file 的规格（不然这条原语模型看不见）", () => {
    const spec = gateToolSpecs().find((s) => s.function.name === "read_file");
    expect(JSON.stringify(spec)).toContain('"paths"');
    expect(spec?.function.description, "说明里要讲什么时候用它——这支原语存在的理由就是省步数").toContain("paths");
  });
});
