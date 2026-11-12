// fs_ops 判卷。此前行为面只有 scripts/tools-check 实跑格，没有 vitest 行为套件——本笔补上，
// 并把 move 源 lstat 纪律（与 delete 同一「名字本身」格）钉死。
// 重点：软链三族（delete 删链不穿透 / move 搬链整条走 / 界外链一律拒）、.agent 禁区双闸、
// 空目录规则、覆盖闸（allow_overwrite + 快照回执）。
// fixture 惯例与 apply-patch.test.ts 同一：mkdtemp 工作区 + snapshot:false 的 ctx。
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fs_ops } from "../src/tools/fs_ops";
import { type ToolContext } from "../src/tools/base";

describe("fs_ops", () => {
  let dir: string;
  const ctx = (): ToolContext => ({ workspace: dir, emit: async () => {}, snapshot: false });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fs-ops-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /** 捕获 ToolError 的消息（ok:false 或抛错都归一成一句）。 */
  const err = async (args: Record<string, unknown>): Promise<string> => {
    try {
      const r = await fs_ops.run(args, ctx());
      return r.ok ? "" : r.output;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  // ---- mkdir ----

  it("mkdir 递归建目录，回执带 changedPaths", async () => {
    const r = await fs_ops.run({ action: "mkdir", path: "a/b/c" }, ctx());
    expect(r.ok).toBe(true);
    expect(await lstat(join(dir, "a/b/c"))).toBeTruthy();
    expect(r.changedPaths).toEqual(["a/b/c"]);
  });

  it("mkdir 幂等：已存在目录直接成功；已存在但**是文件**要拒", async () => {
    expect((await fs_ops.run({ action: "mkdir", path: "d" }, ctx())).ok).toBe(true);
    expect((await fs_ops.run({ action: "mkdir", path: "d" }, ctx())).ok).toBe(true);
    await writeFile(join(dir, "f.txt"), "x", "utf8");
    expect(await err({ action: "mkdir", path: "f.txt" })).toContain("是文件");
  });

  // ---- delete ----

  it("delete 普通文件：文件消失", async () => {
    await writeFile(join(dir, "gone.txt"), "content", "utf8");
    expect((await fs_ops.run({ action: "delete", path: "gone.txt" }, ctx())).ok).toBe(true);
    await expect(lstat(join(dir, "gone.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("delete 软链：删链不穿透，回执点名原指向", async () => {
    await writeFile(join(dir, "real.txt"), "keep", "utf8");
    await symlink("real.txt", join(dir, "link"));
    const r = await fs_ops.run({ action: "delete", path: "link" }, ctx());
    expect(r.ok).toBe(true);
    await expect(readFile(join(dir, "real.txt"), "utf8")).resolves.toBe("keep");
    await expect(lstat(join(dir, "link"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(r.output).toContain("原指向 real.txt");
  });

  it("delete 界外软链：containment 闸拒", async () => {
    await symlink(join(tmpdir(), "fs-ops-outside-probe"), join(dir, "out"));
    expect(await err({ action: "delete", path: "out" })).toContain("越出 workspace 边界");
  });

  it("delete 非空目录拒；清空后可删", async () => {
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "x.txt"), "x", "utf8");
    expect(await err({ action: "delete", path: "sub" })).toContain("非空");
    expect((await fs_ops.run({ action: "delete", path: "sub/x.txt" }, ctx())).ok).toBe(true);
    expect((await fs_ops.run({ action: "delete", path: "sub" }, ctx())).ok).toBe(true);
  });

  it("delete 不存在的名字拒", async () => {
    expect(await err({ action: "delete", path: "nope.txt" })).toContain("目标不存在");
  });

  // ---- move / rename ----

  it("move 文件：内容落目标、源消失、changedPaths 双路", async () => {
    await writeFile(join(dir, "s.txt"), "body", "utf8");
    const r = await fs_ops.run({ action: "move", path: "s.txt", target: "d/s.txt" }, ctx());
    expect(r.ok).toBe(true);
    await expect(readFile(join(dir, "d/s.txt"), "utf8")).resolves.toBe("body");
    await expect(lstat(join(dir, "s.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(r.changedPaths).toEqual(["s.txt", "d/s.txt"]);
  });

  it("move 悬空软链：名字本身可搬，回执点名已移动软链", async () => {
    await symlink("nowhere.txt", join(dir, "dang"));
    const r = await fs_ops.run({ action: "move", path: "dang", target: "moved" }, ctx());
    expect(r.ok).toBe(true);
    expect(await readlink(join(dir, "moved"))).toBe("nowhere.txt");
    expect(r.output).toContain("已移动软链");
  });

  it("move 软链→目录源：回执是软链不是目录（rename 动名字）", async () => {
    await mkdir(join(dir, "sub"));
    await symlink("sub", join(dir, "dirLink"));
    const r = await fs_ops.run({ action: "move", path: "dirLink", target: "dirLink2" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("已移动软链");
    expect(r.output).not.toContain("已移动目录");
  });

  it("move 进已存在目录：拒并给 rename 语义出口", async () => {
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "f.txt"), "x", "utf8");
    expect(await err({ action: "move", path: "f.txt", target: "sub" })).toContain("rename 语义");
  });

  it("move 覆盖闸：无 allow_overwrite 拒；带 true 成功", async () => {
    await writeFile(join(dir, "s.txt"), "new", "utf8");
    await writeFile(join(dir, "t.txt"), "old", "utf8");
    expect(await err({ action: "move", path: "s.txt", target: "t.txt" })).toContain("allow_overwrite");
    expect(await readFile(join(dir, "t.txt"), "utf8")).toBe("old");
    const r = await fs_ops.run({ action: "move", path: "s.txt", target: "t.txt", allow_overwrite: true }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "t.txt"), "utf8")).toBe("new");
  });

  it("move/delete 源 rel 越出 workspace 词法拒", async () => {
    expect(await err({ action: "move", path: "../outside", target: "in" })).toContain("越出 workspace 边界");
    expect(await err({ action: "delete", path: "../outside" })).toContain("越出 workspace 边界");
  });

  it("delete .agent 禁区：词法闸拒", async () => {
    const msg = await err({ action: "delete", path: ".agent/x.json" });
    expect(msg).toContain("系统区");
  });
});
