// 工作区只读文件通道判卷（v5 file 窗格数据面）：列目录排序/截断 + 读文本帽/二进制 + 越界纪律。
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DIR_ENTRIES, listDir, readTextFile, resolveEntry } from "../src/main/workspace-fs";
import { MAX_SIDE_BYTES } from "../src/main/change-diff";

async function makeWorkspace(): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), "cairn-fs-"));
  await mkdir(join(ws, "src"));
  await writeFile(join(ws, "src", "a.ts"), "const a = 1;\n");
  await writeFile(join(ws, "README.md"), "# hi\n");
  await writeFile(join(ws, ".hidden"), "x\n");
  return ws;
}

describe("listDir", () => {
  it("目录在前、名字升序；文件带 size、目录 size=null；隐藏条目也列（看得见才是事实）", async () => {
    const ws = await makeWorkspace();
    const r = await listDir(ws, "");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.name)).toEqual(["src", ".hidden", "README.md"]);
    expect(r.entries[1]).toMatchObject({ kind: "file", size: 2 });
    expect(r.entries[0]).toMatchObject({ name: "src", kind: "dir", size: null });
    expect(r.truncated).toBe(false);
  });

  it("子目录可列（懒加载一层的口径）", async () => {
    const ws = await makeWorkspace();
    const r = await listDir(ws, "src");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.name)).toEqual(["a.ts"]);
  });

  it("越界（../）⇒ 拒；不存在 ⇒ 拒；非目录 ⇒ 拒", async () => {
    const ws = await makeWorkspace();
    expect((await listDir(ws, "../x")).ok).toBe(false);
    expect((await listDir(ws, "ghost")).ok).toBe(false);
    expect((await listDir(ws, "README.md")).ok).toBe(false);
  });

  it("条目数超帽 ⇒ 截断并如实标注", async () => {
    const ws = await mkdtemp(join(tmpdir(), "cairn-fs-big-"));
    await Promise.all(Array.from({ length: MAX_DIR_ENTRIES + 5 }, (_, i) =>
      writeFile(join(ws, `f${String(i).padStart(4, "0")}.txt`), "x")));
    const r = await listDir(ws, "");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(MAX_DIR_ENTRIES);
    expect(r.truncated).toBe(true);
  });
});

describe("readTextFile", () => {
  it("正常读回文本（size = 原始字节数）", async () => {
    const ws = await makeWorkspace();
    const r = await readTextFile(ws, "src/a.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe("const a = 1;\n");
    expect(r.truncated).toBe(false);
    expect(r.size).toBe(13);
  });

  it("二进制 ⇒ 拒；越界 ⇒ 拒；不存在 ⇒ 拒", async () => {
    const ws = await makeWorkspace();
    await writeFile(join(ws, "bin"), Buffer.from([0x61, 0x00]));
    expect((await readTextFile(ws, "bin")).ok).toBe(false);
    expect((await readTextFile(ws, "../etc/passwd")).ok).toBe(false);
    expect((await readTextFile(ws, "ghost.txt")).ok).toBe(false);
  });

  it("超帽 ⇒ truncated=true 且文本被截", async () => {
    const ws = await mkdtemp(join(tmpdir(), "cairn-fs-cap-"));
    await writeFile(join(ws, "big.txt"), "y".repeat(MAX_SIDE_BYTES + 100));
    const r = await readTextFile(ws, "big.txt");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(MAX_SIDE_BYTES);
  });
});

// 2026-10-19：词法 resolveInWorkspace 挡不住工作区内软链（`docs -> ~/.ssh`）。
// 浏览面必须按真实落点复查，否则克隆来的仓库可让文件窗格/路径动作成为任意读通道。
describe("软链越界（真实落点复查）", () => {
  it("指向工作区外的文件/目录一律拒绝（read/list/path-action 三条面）", async () => {
    const outside = await mkdtemp(join(tmpdir(), "cairn-outside-"));
    await writeFile(join(outside, "secret.txt"), "OUTSIDE-SECRET\n");
    await mkdir(join(outside, "dir"));
    const ws = await makeWorkspace();
    await symlink(join(outside, "secret.txt"), join(ws, "link.txt"));
    await symlink(join(outside, "dir"), join(ws, "dirlink"));

    const r = await readTextFile(ws, "link.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("越出 workspace");
    const d = await listDir(ws, "dirlink");
    expect(d.ok).toBe(false);
    const e = await resolveEntry(ws, "link.txt");
    expect(e.ok).toBe(false);
  });

  it("工作区内部的普通文件照常可读（闸不许误伤）", async () => {
    const ws = await makeWorkspace();
    const r = await readTextFile(ws, "README.md");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("# hi\n");
  });
});
