// 写盘摘要里的行增减（能力 2「改动范围最小 / 补丁级 diff」的可度量面）。
// 旧口径只报字节数与处数：整份重写丢掉 20 行，输出上看不出来——要等测试炸。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { edit_file } from "../src/tools/edit_file";
import { write_file } from "../src/tools/write_file";
import type { ToolContext } from "../src/tools/base";

let dir: string;
const ctx = (): ToolContext => ({ workspace: dir, emit: async () => {} });
const run = async (tool: typeof write_file, args: Record<string, unknown>): Promise<string> => {
  const r = await tool.run(args, ctx());
  return r.output;
};
const pad = (n: number, changeAt = -1): string =>
  Array.from({ length: n }, (_, i) => (i === changeAt ? "// touched" : `// line ${String(i)}`)).join("\n") + "\n";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "line-delta-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("写盘摘要报行增减", () => {
  it("新建文件：报「新建 +N 行」，不谎报删除", async () => {
    const out = await run(write_file, { path: "a.ts", content: "x\ny\nz\n" });
    expect(out).toContain("新建 +3 行");
    expect(out).not.toContain("−");
  });

  it("整份重写 60 行文件只动 1 行 ⇒ 报数并提示改用 edit_file", async () => {
    await writeFile(join(dir, "big.ts"), pad(60), "utf8");
    const out = await run(write_file, { path: "big.ts", content: pad(60, 7) });
    expect(out).toContain("+1 −1 行");
    expect(out).toContain("整份重写");
    expect(out).toContain("edit_file");
  });

  it("整份重写确实动了 30 行 ⇒ 不提示（真改写不该被劝去用补丁）", async () => {
    await writeFile(join(dir, "big.ts"), pad(60), "utf8");
    let next = pad(60);
    for (let i = 0; i < 30; i++) next = next.replace(`// line ${String(i)}\n`, "// rewritten\n");
    const out = await run(write_file, { path: "big.ts", content: next });
    expect(out).toContain("+30 −30 行");
    expect(out).not.toContain("提示");
  });

  it("12 行的小文件整份重写不提示（重写与补丁的成本差可忽略）", async () => {
    await writeFile(join(dir, "small.ts"), pad(12), "utf8");
    const out = await run(write_file, { path: "small.ts", content: pad(12, 3) });
    expect(out).toContain("+1 −1 行");
    expect(out).not.toContain("提示");
  });

  it("既有文件大到不统计时，退回旧口径而不是假装是新建（不拿「不知道」当「新建」）", async () => {
    await writeFile(join(dir, "huge.ts"), pad(25000), "utf8"); // ≈ 360KB，过 DELTA_READ_LIMIT_BYTES
    const before = await import("node:fs/promises").then((m) => m.stat(join(dir, "huge.ts")));
    expect(before.size).toBeGreaterThan(256 * 1024);
    const out = await run(write_file, { path: "huge.ts", content: "tiny\n" });
    expect(out).toBe(`已写入 huge.ts（${String(Buffer.byteLength("tiny\n", "utf8"))} 字节）`);
  });

  it("edit_file 的成功输出带行增减（处数说不了动了多少行）", async () => {
    await writeFile(join(dir, "c.ts"), "a\nb\nc\n", "utf8");
    const out = await run(edit_file, { path: "c.ts", old_string: "b", new_string: "B1\nB2" });
    expect(out).toContain("已替换 c.ts（1 处，+2 −1 行）");
  });
});
