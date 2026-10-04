// 写盘摘要里的行增减（能力 2「改动范围最小 / 补丁级 diff」的可度量面）。
// 旧口径只报字节数与处数：整份重写丢掉 20 行，输出上看不出来——要等测试炸。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { snapshotNote } from "../src/tools/snapshot.js";

/** 剥掉「覆盖前原件已存 …」那句尾巴：它属于快照面，不是本条判卷要判的东西。
 *  标记从**生产函数**派生，不在这里抄第二份文案——2026-10-05 修：原写法把正则写死成
 *  `…/snapshots/[^\s]+$`，而后缀里后来加了带空格的说明（`4d52a16c`）⇒ 剥不掉、两支判卷同时红。
 *  派生之后文案再改判卷自动跟上。 */
function stripSnapshotNote(text: string): string {
  const marker = snapshotNote("\u0000").split("\u0000")[0] ?? "";
  const esc = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return text.replace(new RegExp(esc + "[\\s\\S]*$", "u"), "");
}
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

  // 提示的尾半句「也不会漏抄未改的行」是这句建议的全部理由，此前只钉到"提示"两字为止（第 321 页现读）。
  // 两半各钉一次：① 这句承诺真的出现在整份重写那一支；② 同一份 60 行文件交给 edit_file 改一行，其余行逐字节不动。
  // 只钉①＝文案换个说法就静默；只钉②＝产品话说了但没做也看不见。
  it("那句「也不会漏抄未改的行」与它承诺的事一起钉：补丁改一行就只有一行不同", async () => {
    await writeFile(join(dir, "a.ts"), pad(60), "utf8");
    await writeFile(join(dir, "b.ts"), pad(60), "utf8");
    const out = await run(write_file, { path: "a.ts", content: pad(60, 9) });
    expect(out, "整份重写那一支必须把这句理由带到").toContain("也不会漏抄未改的行");
    const patched = await edit_file.run({ path: "b.ts", old_string: "// line 9", new_string: "// line 9 touched" }, ctx());
    expect(patched.ok).toBe(true);
    const before = pad(60).split("\n");
    const after = (await readFile(join(dir, "b.ts"), "utf8")).split("\n");
    expect(after.length, "补丁不该顺手改行数").toBe(before.length);
    const changed = after.filter((l, i) => l !== before[i]).length;
    expect(changed, "未改的行被漏抄/顺手改写都会在这里露出来").toBe(1);
  });

  it("既有文件大到不统计时，退回旧口径而不是假装是新建（不拿「不知道」当「新建」）", async () => {
    await writeFile(join(dir, "huge.ts"), pad(25000), "utf8"); // ≈ 360KB，过 DELTA_READ_LIMIT_BYTES
    const before = await import("node:fs/promises").then((m) => m.stat(join(dir, "huge.ts")));
    expect(before.size).toBeGreaterThan(256 * 1024);
    const out = await run(write_file, { path: "huge.ts", content: "tiny\n" });
    // 这条量的是「大文件不统计行增减时不许冒充新建」——D7 的快照尾巴与它无关，先剥掉再比。
    expect(stripSnapshotNote(out))
      .toBe(`已写入 huge.ts（${String(Buffer.byteLength("tiny\n", "utf8"))} 字节）`);
    expect(out).not.toContain("新建");
  });

  it("edit_file 的成功输出带行增减（处数说不了动了多少行）", async () => {
    await writeFile(join(dir, "c.ts"), "a\nb\nc\n", "utf8");
    const out = await run(edit_file, { path: "c.ts", old_string: "b", new_string: "B1\nB2" });
    expect(out).toContain("已替换 c.ts（1 处，+2 −1 行）");
  });
});
