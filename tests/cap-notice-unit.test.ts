// 判卷 · 截断提示说的量纲必须是**真 cap 的那个量纲**（第 66 页新探的一族）
//
// 现场：`grep` 命中帽与 `glob` 文件帽都把「只列出前 100 条/个」写成
// `[truncated: 输出超过 100KB 上限，已截断]`——`truncationNotice(n)` 的 `n` 是 **KB**，
// 而这两处传进去的是 **条数/文件数**（`MAX_MATCHES=100`、`MAX_FILES=100`）。
// 后果不是措辞难看：模型看到"超过 100KB"会按"再读一段就有"决策（read_file/翻页），
// 而那实际是**条数帽**——唯一出路是收窄查询。这正是本仓反复点名的"文案把模型指去做不到的动作"。
// 同族的反例证明这一族本仓已经会做对：`grep` 的预算分支自己写的是「超 8KB 预算，还有 N 条命中未列出」，
// 一句话里两种量纲只有一支说对了 ⇒ 两支必须分别钉（下面第 1、3 条）。
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grep } from "../src/tools/grep";
import { glob } from "../src/tools/glob";
import { read_file } from "../src/tools/read_file";
import { capLspOutput } from "../src/tools/lsp";
import type { ToolContext } from "../src/tools/base";

let ws = "";
const ctx = (): ToolContext => ({ workspace: ws, emit: async () => {} } as unknown as ToolContext);

beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "cap-notice-unit-"));
  await mkdir(join(ws, "src"), { recursive: true });
  // 120 条**短**命中：输出体量离 100KB 很远 ⇒ 提示里出现 "KB" 就是量纲说错，不是数值巧合
  await writeFile(join(ws, "src", "hits.ts"), Array.from({ length: 120 }, (_, i) =>
    `const needle${String(i)} = ${String(i)};`).join("\n") + "\n", "utf8");
  // 105 个几十字节的文件（放独立目录，免得被别的用例加进来的文件改动分母）
  await mkdir(join(ws, "src", "cap"), { recursive: true });
  for (let i = 0; i < 105; i++) {
    await writeFile(join(ws, "src", "cap", `f${String(i)}.ts`), "export const x = 1;\n", "utf8");
  }
});

afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

describe("条数帽不许说成字节帽", () => {
  it("grep 命中帽：说条数与被省略的条数，不说 KB", async () => {
    const r = await grep.run({ pattern: "const needle" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/100/);
    expect(r.output, r.output.slice(-200)).toContain("20 条"); // 120 - 100
    expect(r.output).not.toMatch(/KB/);
    expect(r.output).toMatch(/收窄|更具体/); // 下一步仍是做得到的那一个
  });

  it("glob 文件帽：说文件数与被省略的个数，不说 KB", async () => {
    const r = await glob.run({ pattern: "**/*.ts", path: "src/cap" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output, r.output.slice(-200)).toContain("5"); // 105 - 100 未列出
    expect(r.output).not.toMatch(/KB/);
  });
});

describe("反向一侧：真按字节截断的那两支，量纲必须还是 KB", () => {
  it("read_file 超 50KB ⇒ 仍说 50KB（我改这两支时不许顺手把它也说成条数）", async () => {
    const big = Array.from({ length: 30 }, () => "a".repeat(1900)).join("\n");
    await writeFile(join(ws, "src", "big.ts"), big, "utf8");
    const r = await read_file.run({ path: "src/big.ts" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/50\s*KB/);
  });

  it("lsp 输出帽 32KB ⇒ 仍说 32KB", () => {
    const capped = capLspOutput("x".repeat(40 * 1024));
    expect(capped).toMatch(/32\s*KB/);
  });

  // ↓ #52：同一句提示承诺的是**字节**上限，而旧实现量的是 `text.length`（字符）。
  // 中文场景下两者差 3 倍 ⇒ 后果不是措辞，是"上限根本没生效"。
  it("lsp 中文主导的输出也必须真的被封顶在 32KB（旧实现：9 万字节原样通过，还自称 32KB 上限）", () => {
    const cjk = "中".repeat(30 * 1024); // 30720 字符 ⇒ 旧实现判为"未超限"，但它是 92160 字节
    expect(Buffer.byteLength(cjk, "utf8")).toBeGreaterThan(32 * 1024);
    const capped = capLspOutput(cjk);
    expect(capped).toContain("[truncated:");
    // 提示之后剩下的正文必须真的在 32KB 内（半字符不算越界：整个输出只允许提示那一行进账）
    const body = capped.slice(0, capped.indexOf("\n[truncated:"));
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(32 * 1024);
  });

  it("反向一侧：ASCII 输出的截断位逐字不变（改量纲不许顺手挪动本来就对的那一支）", () => {
    const ascii = "x".repeat(40 * 1024);
    const capped = capLspOutput(ascii);
    expect(capped.startsWith("x".repeat(32 * 1024))).toBe(true);
    expect(capped.slice(0, 32 * 1024 + 1)).toBe("x".repeat(32 * 1024) + "\n");
    expect(Buffer.byteLength(capped.slice(0, 32 * 1024), "utf8")).toBe(32 * 1024);
  });

  it("截断不许留半个 UTF-8 序列（半个字符进 provider 变问号）", () => {
    const capped = capLspOutput("中".repeat(40 * 1024));
    const body = capped.slice(0, capped.indexOf("\n[truncated:"));
    expect(body).not.toContain("\uFFFD");
    // 每个"中"占 3 字节：32768 不是 3 的倍数 ⇒ 真按字节切就必须回退到字符边界
    expect(Buffer.byteLength(body, "utf8") % 3).toBe(0);
  });
});

describe("同一句里两种量纲不许并存（改一半留一半的形状）", () => {
  it("grep 与 glob 的帽提示：出现 KB 就不许同时出现「条/个」，反之亦然", async () => {
    const g = await grep.run({ pattern: "const needle" }, ctx());
    const b = await glob.run({ pattern: "**/*.ts", path: "src/cap" }, ctx());
    for (const out of [String(g.output), String(b.output)]) {
      const tail = out.slice(-200);
      const hasKb = /KB/.test(tail);
      const hasCount = /条|个文件/.test(tail);
      expect(hasKb && hasCount, "量纲混在一句里：" + tail).toBe(false);
    }
  });
});

// ↓ #57：字节帽的提示要说清"少了多少"，而 `read_file` 更狠的一格是**行数口径**——
// 旧写法同时命中行帽与字节帽时报的是"请求的行数"（实测说 400 行、真交付 205 行），
// 模型照着提示写 offset=401 就静默跳过 195 行。这一族的判据写法是"照着那句话真做一遍"。
describe("字节帽的省略量与下一跳（#57）", () => {
  const manyLines = "src/many.md";
  const lineAt = (i: number): string => "L" + String(i) + " " + "中文正文示例，用来把这一行撑到五百字节以上。".repeat(4);
  const TOTAL_LINES = 500;

  beforeAll(async () => {
    await writeFile(join(ws, manyLines), Array.from({ length: TOTAL_LINES }, (_, i) => lineAt(i + 1)).join("\n") + "\n", "utf8");
  });

  const bodyOf = (out: string): string => out.slice(0, out.indexOf("\n[truncated:"));

  it("read_file 的行数提示必须等于真交付的行数，且旧口径的谎报串不许回来", async () => {
    const r = await read_file.run({ path: manyLines, offset: 1, limit: 400 }, ctx());
    const deliveredComplete = bodyOf(r.output).split("\n").length - 1;
    const claimed = Number((r.output.match(/本次完整交付 (\d+) 行/) ?? [])[1]);
    expect(claimed, r.output.slice(-400)).toBe(deliveredComplete);
    // 反向哨兵：旧写法那句"仅显示 400 行"（= 请求数，不是交付数）正是漏读的源头
    expect(r.output).not.toMatch(/仅显示 \d+ 行/);
    expect(deliveredComplete).toBeLessThan(400); // 前提：字节帽真的切在行中间
  });

  it("最后一跳真跑：按提示给的 offset 再读一次，第二跳的第一行正是被切半的那一行", async () => {
    const first = await read_file.run({ path: manyLines, offset: 1, limit: 400 }, ctx());
    const nextOffset = Number((first.output.match(/接着读用 offset=(\d+)/) ?? [])[1]);
    expect(Number.isInteger(nextOffset)).toBe(true);
    const deliveredComplete = bodyOf(first.output).split("\n").length - 1;
    expect(nextOffset).toBe(1 + deliveredComplete); // 半行的那一行必须重读，不算"已交付"
    const second = await read_file.run({ path: manyLines, offset: nextOffset, limit: 400 }, ctx());
    const secondBody = bodyOf(second.output);
    expect(secondBody.split("\n")[0]).toBe(lineAt(nextOffset));
    // 合起来不许漏行：第一跳的最后完整行 → 第二跳的第一行必须紧邻
    expect(bodyOf(first.output).split("\n")[deliveredComplete - 1]).toBe(lineAt(deliveredComplete));
  });

  it("read_file 的字节帽提示要报出省略的字节数（只说『已截断』＝模型以为看全）", async () => {
    const r = await read_file.run({ path: manyLines, offset: 1, limit: 400 }, ctx());
    const omitted = Number((r.output.match(/还有 (\d+) 字节未显示/) ?? [])[1]);
    expect(omitted).toBeGreaterThan(0);
    // 报的数要真对得上：请求体（400 行）的实际字节数 - 交付正文 = 省略量
    const requestedBytes = Buffer.byteLength(
      Array.from({ length: 400 }, (_, i) => lineAt(i + 1)).join("\n"), "utf8");
    expect(omitted).toBe(requestedBytes - Buffer.byteLength(bodyOf(r.output), "utf8"));
  });

  it("lsp 的 32KB 提示同样报省略量；ASCII 那一支的截断位仍是逐字不变的那一格", () => {
    const cjk = "中".repeat(40 * 1024); // 122880 字节
    const capped = capLspOutput(cjk);
    const body = capped.slice(0, capped.indexOf("\n[truncated:"));
    const omitted = Number((capped.match(/还有 (\d+) 字节未显示/) ?? [])[1]);
    expect(omitted).toBe(122880 - Buffer.byteLength(body, "utf8"));
    // 反向：不超帽的输出一个字都不许多说
    expect(capLspOutput("short")).toBe("short");
  });
});
