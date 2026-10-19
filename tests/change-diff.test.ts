// 变更审阅（v4 diff 通道）判卷：unified hunks 纯函数 + 真快照目录端到端 + 边界纪律。
// 纪律面（与全仓同款）：不配对拒、越界拒、二进制拒、快照缺失不降级成"全新增"、超帽必标 truncated。
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PATCH_LINES, MAX_SIDE_BYTES, diffHunks, readChangeDiff, restoreSnapshot, splitLines } from "../src/main/change-diff";
import { SNAPSHOT_ROOT } from "../src/tools/snapshot";

async function makeWorkspace(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "cairn-diff-"));
}

describe("diffHunks（纯函数）", () => {
  it("无差异 ⇒ 空；增删各标对；上下文行在场", () => {
    expect(diffHunks(["a", "b"], ["a", "b"])).toEqual([]);
    const hunks = diffHunks(["a", "b", "c"], ["a", "B", "c"]);
    expect(hunks).toHaveLength(1);
    const kinds = hunks[0]!.lines.map((l) => l.kind);
    expect(kinds).toContain("ctx");
    expect(kinds).toContain("del");
    expect(kinds).toContain("add");
    expect(hunks[0]!.header).toBe("@@ -1,3 +1,3 @@");
  });

  it("相隔很远的两处改动 ⇒ 两个 hunk（上下文 3 行外独立成段）", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line${String(i)}`);
    const after = [...before];
    after[2] = "CHANGED-A";
    after[27] = "CHANGED-B";
    const hunks = diffHunks(before, after);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.lines.some((l) => l.text === "CHANGED-A")).toBe(true);
    expect(hunks[1]!.lines.some((l) => l.text === "CHANGED-B")).toBe(true);
  });

  it("公共前缀/后缀不进 hunk 主体（header 的行号对得上）", () => {
    const before = ["pre1", "pre2", "old", "post1", "post2"];
    const after = ["pre1", "pre2", "new", "post1", "post2"];
    const hunks = diffHunks(before, after);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.header).toBe("@@ -1,5 +1,5 @@");
    const del = hunks[0]!.lines.find((l) => l.kind === "del");
    expect(del?.oldNo).toBe(3);
    const add = hunks[0]!.lines.find((l) => l.kind === "add");
    expect(add?.newNo).toBe(3);
  });

  it("splitLines：尾换行不产生幽灵行；空内容为零行", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("readChangeDiff（真临时目录）", () => {
  it("修改：快照 vs 当前 ⇒ created=false、del+add 都在、bytes 两侧在场", async () => {
    const ws = await makeWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "a.ts"), "const x = 2;\nkeep\n");
    const snapshotId = `${SNAPSHOT_ROOT}/123--c1/src/a.ts`;
    await mkdir(join(ws, SNAPSHOT_ROOT, "123--c1", "src"), { recursive: true });
    await writeFile(join(ws, snapshotId), "const x = 1;\nkeep\n");
    const r = await readChangeDiff(ws, "src/a.ts", snapshotId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(false);
    expect(r.hunks).toHaveLength(1);
    expect(r.hunks[0]!.lines.some((l) => l.kind === "del" && l.text === "const x = 1;")).toBe(true);
    expect(r.hunks[0]!.lines.some((l) => l.kind === "add" && l.text === "const x = 2;")).toBe(true);
    expect(r.bytes.before).toBeGreaterThan(0);
    expect(r.truncated).toBe(false);
  });

  it("新建（无快照）⇒ created=true 且全部为 add", async () => {
    const ws = await makeWorkspace();
    await writeFile(join(ws, "fresh.ts"), "line1\nline2\n");
    const r = await readChangeDiff(ws, "fresh.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.hunks[0]!.lines.every((l) => l.kind === "add")).toBe(true);
  });

  it("快照与路径不配对 ⇒ 拒（防张冠李戴）", async () => {
    const ws = await makeWorkspace();
    await writeFile(join(ws, "a.ts"), "x\n");
    const r = await readChangeDiff(ws, "a.ts", `${SNAPSHOT_ROOT}/123--c1/OTHER.ts`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("不配对");
  });

  it("路径越界（../）⇒ 拒（审阅面不是任意读通道）", async () => {
    const ws = await makeWorkspace();
    const r = await readChangeDiff(ws, "../outside.txt");
    expect(r.ok).toBe(false);
  });

  it("二进制（含 NUL）⇒ 拒并说明", async () => {
    const ws = await makeWorkspace();
    await writeFile(join(ws, "bin.dat"), Buffer.from([0x61, 0x00, 0x62]));
    const r = await readChangeDiff(ws, "bin.dat");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("二进制");
  });

  it("快照声明在场但文件缺失 ⇒ 拒（不降级成「全新增」）", async () => {
    const ws = await makeWorkspace();
    await writeFile(join(ws, "a.ts"), "x\n");
    const r = await readChangeDiff(ws, "a.ts", `${SNAPSHOT_ROOT}/123--c1/a.ts`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("快照不存在");
  });

  it("当前文件不存在 ⇒ 拒并说明", async () => {
    const ws = await makeWorkspace();
    const r = await readChangeDiff(ws, "ghost.ts");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("当前文件不存在");
  });

  it("超字节帽 ⇒ truncated=true（不假装完整）", async () => {
    const ws = await makeWorkspace();
    const big = "x".repeat(MAX_SIDE_BYTES + 1024) + "\n";
    await writeFile(join(ws, "big.txt"), big);
    const r = await readChangeDiff(ws, "big.txt");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.truncated).toBe(true);
  });

  it("单个 hunk 超行数帽 ⇒ 保留前缀并标「截断」，不把整块丢掉（真机回归）", async () => {
    const ws = await makeWorkspace();
    // 4,001 行就够触发 MAX_PATCH_LINES=4,000；字节远低于 512 KiB。
    const lines = Array.from({ length: MAX_PATCH_LINES + 1 }, (_, i) => `L${String(i)}`);
    await writeFile(join(ws, "many.txt"), lines.join("\n") + "\n");
    const r = await readChangeDiff(ws, "many.txt");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.truncated).toBe(true);
    // 修复前：hunks=[]，检查器说「没有差异」。
    expect(r.hunks).toHaveLength(1);
    expect(r.hunks[0]!.lines).toHaveLength(MAX_PATCH_LINES);
    expect(r.hunks[0]!.lines[0]!.kind).toBe("add");
    expect(r.hunks[0]!.header).toContain("截断");
  });
});

describe("restoreSnapshot（v11 检查器「撤销此文件改动」）", () => {
  it("还原：快照字节覆盖当前文件；写前给当前版本留 undo 快照（撤销可再撤销）", async () => {
    const ws = await makeWorkspace();
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "a.ts"), "const x = 2;\n");
    const snapshotId = `${SNAPSHOT_ROOT}/123--c1/src/a.ts`;
    await mkdir(join(ws, SNAPSHOT_ROOT, "123--c1", "src"), { recursive: true });
    await writeFile(join(ws, snapshotId), "const x = 1;\n");

    const r = await restoreSnapshot(ws, "src/a.ts", snapshotId);
    expect(r.ok).toBe(true);
    expect(await readFile(join(ws, "src", "a.ts"), "utf8")).toBe("const x = 1;\n");

    // 还原前版本进了新快照（`<ms>--undo/<rel>`），内容 = 被覆盖掉的 "const x = 2;\n"
    const dirs = await readdir(join(ws, SNAPSHOT_ROOT));
    const undoDir = dirs.find((d) => d.endsWith("--undo"));
    expect(undoDir).toBeTypeOf("string");
    expect(await readFile(join(ws, SNAPSHOT_ROOT, undoDir!, "src", "a.ts"), "utf8")).toBe("const x = 2;\n");
  });

  it("目标曾被删除：还原 = 重建（目录一并补回）", async () => {
    const ws = await makeWorkspace();
    const snapshotId = `${SNAPSHOT_ROOT}/123--c1/gone.ts`;
    await mkdir(join(ws, SNAPSHOT_ROOT, "123--c1"), { recursive: true });
    await writeFile(join(ws, snapshotId), "bring me back\n");

    const r = await restoreSnapshot(ws, "gone.ts", snapshotId);
    expect(r.ok).toBe(true);
    expect(await readFile(join(ws, "gone.ts"), "utf8")).toBe("bring me back\n");
  });

  it("不配对 / 快照缺失 / 越界：三种拒（与 readChangeDiff 同口径）", async () => {
    const ws = await makeWorkspace();
    await writeFile(join(ws, "a.ts"), "x\n");
    const unpaired = await restoreSnapshot(ws, "a.ts", `${SNAPSHOT_ROOT}/123--c1/OTHER.ts`);
    expect(unpaired.ok).toBe(false);
    if (!unpaired.ok) expect(unpaired.error).toContain("不配对");

    const missing = await restoreSnapshot(ws, "a.ts", `${SNAPSHOT_ROOT}/123--c1/a.ts`);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("快照不存在");

    const escape = await restoreSnapshot(ws, "../outside.txt", `${SNAPSHOT_ROOT}/123--c1/../outside.txt`);
    expect(escape.ok).toBe(false);
  });
});
