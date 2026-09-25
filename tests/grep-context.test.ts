import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { grep } from "../src/tools/grep";
import type { ToolContext } from "../src/tools";

let ws = "";
afterEach(async () => { if (ws) await rm(ws, { recursive: true, force: true }); });

async function newCtx(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "grep-ctx-"));
  return { workspace: ws };
}
const write = async (rel: string, text: string): Promise<void> => {
  const abs = join(ws, rel);
  await mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
  await writeFile(abs, text, "utf8");
};
/** 命中行（Line N: 前缀）——邻行不计入，所以断言「命中了几条」不受上下文档位影响。 */
const hitLines = (out: string): string[] => out.split("\n").filter((l) => l.startsWith("Line "));
/** 邻行（"  N | text" 前缀）。 */
const ctxLines = (out: string): string[] => out.split("\n").filter((l) => /^ {2}\d+ \| /.test(l));

describe("grep context / fixed_strings（查改一体：一次调用拿到改点现场）", () => {
  it("缺省不带上下文：输出形态与旧口径逐字一致（零回归）", async () => {
    const ctx = await newCtx();
    await write("src/a.ts", "one\nneedle here\nthree\n");
    const r = await grep.run({ pattern: "needle" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toBe("src/a.ts:\nLine 2: needle here");
    expect(ctxLines(r.output)).toEqual([]);
  });

  it("context=1 带回前后各一行，且命中行与邻行前缀可分辨（拼 old_string 不会拿错行）", async () => {
    const ctx = await newCtx();
    await write("src/a.ts", "one\ntwo\nneedle here\nfour\nfive\n");
    const r = await grep.run({ pattern: "needle", context: 1 }, ctx);
    expect(r.output).toBe(["src/a.ts:", "  2 | two", "Line 3: needle here", "  4 | four"].join("\n"));
  });

  it("上下文帽到 5 行：context=99 也只各带 5 行（宽档位不许把预算吃光）", async () => {
    const ctx = await newCtx();
    const lines = Array.from({ length: 21 }, (_, i) => (i === 10 ? "needle" : "filler" + String(i)));
    await write("big.txt", lines.join("\n") + "\n");
    const r = await grep.run({ pattern: "^needle$", context: 99 }, ctx);
    expect(ctxLines(r.output).length).toBe(10);
    expect(ctxLines(r.output).map((l) => l.slice(2, l.indexOf(" |")))).toEqual(
      ["6", "7", "8", "9", "10", "12", "13", "14", "15", "16"],
    );
  });

  it("邻行不占命中额：130 条命中 + context=1 仍列满 100 条，截断走旧口径而非预算", async () => {
    const ctx = await newCtx();
    // 命中之间隔两行填充：否则 rg 根本不发邻行事件，「不占额」这条会 vacuous 通过。
    const lines: string[] = [];
    for (let i = 1; i <= 130; i++) lines.push("filler " + String(i), "pad " + String(i), "needle " + String(i));
    await write("many.txt", lines.join("\n") + "\n");
    const r = await grep.run({ pattern: "needle", context: 1 }, ctx);
    expect(hitLines(r.output).length).toBe(100);
    expect(ctxLines(r.output).length).toBeGreaterThan(0);
    expect(r.output).toContain("条命中"); // 第 66 页：命中帽说条数，不说 KB（旧句把 100 条写成 100KB）
    expect(r.output).not.toContain("KB");
    expect(r.output).not.toContain("KB 预算");
  });

  it("fixed_strings=true 按字面串匹配：正则模式会把 a.b 曲解成多命中（假阳性且不报错）", async () => {
    const ctx = await newCtx();
    await write("lit.txt", "a.b\naxb\n");
    const fixed = await grep.run({ pattern: "a.b", fixed_strings: true }, ctx);
    expect(hitLines(fixed.output).length).toBe(1);
    const regex = await grep.run({ pattern: "a.b" }, ctx);
    expect(hitLines(regex.output).length).toBe(2); // a.b 与 axb 都中——不告诉模型就是静默错
  });

  it("含元字符的调用形状：不加 fixed_strings 时 rg 直接报错（工具抛错，由 loop 转 ok:false）", async () => {
    const ctx = await newCtx();
    await write("call.ts", "computeTotal(1);\n");
    await expect(grep.run({ pattern: "computeTotal(" }, ctx)).rejects.toThrow(/rg 退出码/u);
    const r = await grep.run({ pattern: "computeTotal(", fixed_strings: true }, ctx);
    expect(r.output).toContain("Line 1: computeTotal(1);");
  });

  it("上下文预算兜住宽查询：超 8KB 即止并报出未列出条数（不静默半路断）", async () => {
    const ctx = await newCtx();
    const pad = "x".repeat(400);
    const lines: string[] = [];
    for (let i = 1; i <= 40; i++) lines.push("needle " + String(i) + " " + pad);
    await write("wide.txt", lines.join("\n") + "\n");
    const r = await grep.run({ pattern: "needle", context: 5 }, ctx);
    expect(r.output.length).toBeLessThan(8 * 1024 + 400);
    expect(r.output).toContain("上下文输出超 8KB 预算");
    const shown = hitLines(r.output).length;
    expect(shown).toBeGreaterThan(0);
    // 不变式而非算式：列出 + 未列出 == 真实命中数。截在哪里由 rg 的邻行交错决定，
    // 但「报了几个就真少几个」这条必须成立——否则模型会以为已经看全了。
    const m = /还有 (\d+) 条命中未列出/u.exec(r.output);
    expect(m).not.toBeNull();
    expect(shown + Number(m![1])).toBe(40);
  });

  it("无命中首行仍是「无命中」（加了邻行收集也不把别文件的上下文当成命中）", async () => {
    const ctx = await newCtx();
    await write("src/a.ts", "one\ntwo\n");
    const r = await grep.run({ pattern: "nothing-here", context: 3 }, ctx);
    expect(r.output.startsWith("无命中")).toBe(true);
  });
});
