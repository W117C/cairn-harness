// D7 快照的**取回路由**（能力 7「可回滚」／能力 8「可接管」交接处那一格）。
//
// 为什么要单独一支判卷：`src/tools/snapshot.ts` 的头注释写着「路径要出现在 tool_result 正文里，
// 模型才知道自己能把它读回来」，而既有判卷（`tests/snapshot-d7.test.ts`）验的是**快照文件本身**
// 与原件一致——那是用 `node:fs` 直接读的。模型手里没有 `readFile`，它只有 `read_file` 工具，
// 而 `read_file` 的交付是**按行**拼起来的：末行换行不保留、单行超 2000 字符被切、
// 输出超 50 KiB 被切、疑似二进制直接拒读。⇒ 「有快照」与「模型能逐字取回」是两件事，
// 此前没有任何尺把它们分开量过。本文件把这些帽实测成事实，并钉住回执里新增的那句实话。
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { edit_file } from "../src/tools/edit_file";
import { read_file } from "../src/tools/read_file";
import { write_file } from "../src/tools/write_file";

let ws: string;
beforeEach(async () => {
  ws = await realpath(await mkdtemp(join(tmpdir(), "dsh-rollback-")));
});
const ctx = (callId: string) => ({ workspace: ws, callId });
/** read_file 的交付正文（去掉末尾那些 `[...]` 旗子）——这就是模型"看到的文件内容"。 */
const delivered = (out: string): string => out.replace(/\n\[[^\n]*\]\s*$/u, "");

describe("D7 快照取回路由：模型真用的那两件工具（read_file + write_file）", () => {
  it("最简单的文本文件也不逐字：交付缺一个末行换行；照回执补回来才能复原", async () => {
    const rel = "src/a.ts";
    const original = "export const a = 1; // 用户未提交的手改\n\nexport default a;\n";
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, rel), original, "utf8");

    const bad = await write_file.run({ path: rel, content: "export const a = 2;\n" }, ctx("rb-1"));
    expect(bad.ok).toBe(true);
    const snapId = bad.snapshotId as string;
    expect(snapId, "覆盖已有文件必须落快照").toBeTypeOf("string");
    expect(String(bad.output)).toContain("覆盖前原件已存");
    // 回执必须**出声**说清这条路由会在哪一格丢字节（2026-10-04 新增的那半句）
    expect(String(bad.output), "只给路径不告诉模型怎么取才不丢 = 装饰性承诺").toContain("不保留末行换行");

    const back = await read_file.run({ path: snapId }, ctx("rb-2"));
    expect(back.ok, "read_file 不该拒绝读 .agent/snapshots/**（拒写那道闸只管写）").toBe(true);
    expect(delivered(back.output), "交付缺的正是末行换行：静默差一个字节，git 会显示整行变了").toBe(original.slice(0, -1));

    const undo = await write_file.run({ path: rel, content: delivered(back.output) + "\n" }, ctx("rb-3"));
    expect(undo.ok).toBe(true);
    expect(await readFile(join(ws, rel), "utf8"), "按回执补回末行换行 ⇒ 复原必须是逐字的原件").toBe(original);
    expect(undo.snapshotId, "回滚本身也是一次覆盖 ⇒ 坏内容也该留得回").toBeTypeOf("string");
    expect(await readFile(join(ws, undo.snapshotId as string), "utf8")).toBe("export const a = 2;\n");
  });

  it("edit_file 同口径：回执里那句路径可以直接喂给 read_file（不是只有 id）", async () => {
    const rel = "b.ts";
    await writeFile(join(ws, rel), "one\ntwo\n", "utf8");
    const r = await edit_file.run({ path: rel, old_string: "two", new_string: "TWO" }, ctx("rb-4"));
    expect(r.ok).toBe(true);
    const note = String(r.output).match(/覆盖前原件已存 (\S+?)（/u);
    expect(note, "回执必须给一条能直接用的路径").not.toBeNull();
    const back = await read_file.run({ path: note![1]! }, ctx("rb-5"));
    expect(back.ok).toBe(true);
    expect(delivered(back.output)).toBe("one\ntwo");
    expect(delivered(back.output) + "\n").toBe("one\ntwo\n");
  });

  it("单行超 2000 字符（压缩产物那一类）⇒ 交付被切一刀并出声，快照字节没丢", async () => {
    const rel = "dist/bundle.js";
    await mkdir(join(ws, "dist"), { recursive: true });
    const original = 'var x="' + "A".repeat(4000) + '";\n';
    await writeFile(join(ws, rel), original, "utf8");

    const bad = await write_file.run({ path: rel, content: "var x=1;\n" }, ctx("rb-6"));
    const back = await read_file.run({ path: bad.snapshotId as string }, ctx("rb-7"));
    expect(back.ok).toBe(true);
    expect(String(back.output)).toContain("[行截断]");
    expect(delivered(back.output), "这一格路由会丢数据：钉成事实，别让下一个人以为能复原").not.toBe(original);
    expect(await readFile(join(ws, bad.snapshotId as string), "utf8"), "丢的只是读回来这一刀，快照是按字节抄的").toBe(original);
  });

  it("超输出字节帽（50 KiB）⇒ 交付被切且报出缺多少，快照大小仍等于原件", async () => {
    const rel = "big.txt";
    const original = Array.from({ length: 3000 }, (_, i) => "line " + String(i) + " " + "B".repeat(30)).join("\n") + "\n";
    expect(Buffer.byteLength(original, "utf8")).toBeGreaterThan(50 * 1024);
    await writeFile(join(ws, rel), original, "utf8");

    const bad = await write_file.run({ path: rel, content: "gone\n" }, ctx("rb-8"));
    const back = await read_file.run({ path: bad.snapshotId as string }, ctx("rb-9"));
    expect(back.ok).toBe(true);
    expect(String(back.output), "帽生效必须出声，否则模型以为自己读全了").toContain("truncated");
    expect(delivered(back.output)).not.toBe(original);
    expect((await stat(join(ws, bad.snapshotId as string))).size).toBe(Buffer.byteLength(original, "utf8"));
  });

  it("二进制原件 ⇒ read_file 直接拒（抛 ToolError，不把乱码喂进上下文），而快照逐字完好", async () => {
    const rel = "assets/logo.png";
    await mkdir(join(ws, "assets"), { recursive: true });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 0, 255]);
    await writeFile(join(ws, rel), bytes);

    const bad = await write_file.run({ path: rel, content: "text now\n" }, ctx("rb-10"));
    expect(await readFile(join(ws, bad.snapshotId as string))).toEqual(bytes);
    await expect(read_file.run({ path: bad.snapshotId as string }, ctx("rb-11")), "二进制必须拒绝按文本读").rejects.toThrow(/二进制/u);
  });

  it("反向守卫：回滚不许变成往系统区植文件——写 .agent/snapshots/** 一律拒", async () => {
    await expect(write_file.run({ path: ".agent/snapshots/planted.txt", content: "x\n" }, ctx("rb-12")))
      .rejects.toThrow(/\.agent/u);
    expect(await stat(join(ws, ".agent", "snapshots", "planted.txt")).catch(() => null)).toBeNull();
  });

  it("opt-out 那一档说实话：ctx.snapshot=false 时没有快照，回执也不提它", async () => {
    const rel = "c.ts";
    await writeFile(join(ws, rel), "old\n", "utf8");
    const r = await write_file.run({ path: rel, content: "new\n" }, { ...ctx("rb-13"), snapshot: false });
    expect(r.ok).toBe(true);
    expect(r.snapshotId, "关掉快照就不该假装能回滚").toBeUndefined();
    expect(String(r.output)).not.toContain("覆盖前原件已存");
  });
});
