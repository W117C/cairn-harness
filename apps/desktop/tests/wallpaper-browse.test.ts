// 应用内选择器判卷：目录先列、白名单过滤、隐藏不列、面包屑可上溯。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { breadcrumbOf, browseDirectory } from "../src/main/wallpaper-browse";

const made: string[] = [];
const mk = async (): Promise<string> => { const d = await mkdtemp(join(tmpdir(), "wp-browse-")); made.push(d); return d; };
afterEach(async () => { await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe("应用内选择器", () => {
  it("目录排前、只列白名单扩展名、隐藏文件不列", async () => {
    const root = await mk();
    await mkdir(join(root, "zzz-dir"));
    await writeFile(join(root, "b.png"), "x");
    await writeFile(join(root, "a.mp4"), "x");
    await writeFile(join(root, "notes.txt"), "x");
    await writeFile(join(root, ".hidden.png"), "x");
    const out = await browseDirectory(root);
    expect(out.ok).toBe(true);
    expect(out.entries?.map((e) => [e.kind, e.name])).toEqual([
      ["dir", "zzz-dir"],
      ["file", "a.mp4"],
      ["file", "b.png"],
    ]);
  });

  it("不存在的目录 / 文件路径 ⇒ 如实拒绝", async () => {
    const root = await mk();
    expect((await browseDirectory(join(root, "nope"))).ok).toBe(false);
    const file = join(root, "x.png");
    await writeFile(file, "x");
    expect(await browseDirectory(file)).toMatchObject({ ok: false, error: "不是目录" });
    expect((await browseDirectory("   ")).ok).toBe(false);
  });

  it("面包屑从根到当前；父目录到根为 null", async () => {
    const root = await mk();
    const deep = join(root, "a", "b");
    await mkdir(deep, { recursive: true });
    const out = await browseDirectory(deep);
    expect(out.parent).toBe(join(root, "a"));
    const crumbs = breadcrumbOf(deep);
    expect(crumbs[crumbs.length - 1]!.path).toBe(deep);
    expect(crumbs[0]!.path).toBe("/");
  });
});
