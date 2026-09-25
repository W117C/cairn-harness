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
