// M2 · apply_patch 的判卷（PLAN §M2：正常应用 / 上下文漂移 / 部分 hunk 失败 / 空补丁 / 二进制拒）。
// 分成两层：`patch-parse.ts` 是纯函数（零 IO，可离线判卷）；`apply_patch.ts` 只负责把计划落到盘上，
// 并把仓里已有的四道路径闸、覆盖前快照、写后诊断、影响面回注全部复用过来——本工具不许另立第二套写盘纪律。
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parsePatch, PatchParseError } from "../src/tools/patch-parse";
import { apply_patch } from "../src/tools/apply_patch";
import type { ToolContext } from "../src/tools/base";

describe("patch-parse：统一 diff → 逐文件逐 hunk 计划", () => {
  it("一个 update 段解析出路径、行号区间与带标记的行", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,3 @@",
      " keep1",
      "-old",
      "+new",
      " keep2",
    ].join("\n");
    const files = parsePatch(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/a.ts");
    expect(files[0].op).toBe("update");
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0].oldStart).toBe(10);
    expect(files[0].hunks[0].lines.map((l) => l.mark + l.text)).toEqual([" keep1", "-old", "+new", " keep2"]);
  });

  it("`--- /dev/null` 是新建，路径取 `+++ b/` 那一侧", () => {
    const files = parsePatch([
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
    ].join("\n"));
    expect(files[0].op).toBe("create");
    expect(files[0].path).toBe("new.ts");
    expect(files[0].hunks[0].lines).toHaveLength(2);
  });

  it("`+++ /dev/null` 是删除（本工具会拒，但必须认出它是删除而不是当成空补丁）", () => {
    const files = parsePatch([
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line one",
      "-line two",
    ].join("\n"));
    expect(files[0].op).toBe("delete");
    expect(files[0].path).toBe("gone.ts");
  });

  it("二进制段从 `Binary files a/… and b/… differ` 取路径（该段没有 +++ 行）", () => {
    const files = parsePatch([
      "diff --git a/logo.png b/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/logo.png and b/logo.png differ",
    ].join("\n"));
    expect(files[0].op).toBe("binary");
    expect(files[0].path).toBe("logo.png");
  });

  it("仅模式变更的段没有内容 hunk ⇒ 标成 mode，不报错也不当成空补丁", () => {
    const files = parsePatch([
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
    ].join("\n"));
    expect(files).toHaveLength(1);
    expect(files[0].op).toBe("mode");
    expect(files[0].hunks).toHaveLength(0);
  });

  it("改名段标成 rename（本工具会拒：它只应用内容改动）", () => {
    const files = parsePatch([
      "diff --git a/old.ts b/new.ts",
      "similarity index 92%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-a",
      "+b",
    ].join("\n"));
    expect(files[0].op).toBe("rename");
    expect(files[0].path).toBe("new.ts");
  });

  it("`\\ No newline at end of file` 归到它前面那一行所在的那一侧", () => {
    const files = parsePatch([
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
    ].join("\n"));
    expect(files[0].hunks[0].oldNoNewline).toBe(true);
    expect(files[0].hunks[0].newNoNewline).toBe(true);
    expect(files[0].hunks[0].lines.map((l) => l.mark)).toEqual(["-", "+"]);
  });

  it("hunk 声明的行数与正文对不上（补丁被截断）⇒ 报错，不收满就当成完整 hunk 应用", () => {
    const truncated = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,4 +1,4 @@",
      " keep1",
      "-old",
      "+new",
    ].join("\n");
    expect(() => parsePatch(truncated)).toThrow(PatchParseError);
  });

  it("补丁末尾的空行不会被当成多出来的一行上下文（收满即停手）", () => {
    const files = parsePatch([
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep1",
      "-old",
      "+new",
      "",
    ].join("\n"));
    // 这个 hunk 本来就是 3 行（1 上下文 + 1 删 + 1 增，旧侧 2 行、新侧 2 行）；
    // 判的点是尾随空行没有被收成第 4 行上下文。
    expect(files[0].hunks[0].lines.map((l) => l.mark)).toEqual([" ", "-", "+"]);
  });

  it("没有 `diff --git` 打头的 @@ 行 ⇒ 报错（不静默产出一个空计划）", () => {
    expect(() => parsePatch("@@ -1,1 +1,1 @@\n-a\n+b\n")).toThrow(PatchParseError);
  });
});

const A_ORIG = ["line1", "line2", "line3", "line4", "line5", "line6"].join("\n") + "\n";
const B_ORIG = ["alpha", "beta", "gamma"].join("\n") + "\n";

/** a.ts 两处 + b.ts 一处：中位真实提交就是这种形状（基线读数：仅源码每笔 3 处）。 */
const TWO_FILE_PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " line1",
  "-line2",
  "+LINE2",
  " line3",
  "@@ -5,2 +5,2 @@",
  "-line5",
  "+LINE5",
  " line6",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -2,1 +2,2 @@",
  " beta",
  "+extra",
].join("\n");

describe("apply_patch：把计划落到盘上", () => {
  let dir: string;
  const ctx = (): ToolContext => ({ workspace: dir, emit: async () => {}, snapshot: false });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "apply-patch-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), A_ORIG, "utf8");
    await writeFile(join(dir, "src", "b.ts"), B_ORIG, "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const err = async (patch: unknown): Promise<string> => {
    try {
      const r = await apply_patch.run({ patch }, ctx());
      return r.ok ? "" : r.output;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  /** 现场取两份文件的当前内容当对照物（不拿 A_ORIG 当「未改动」——测试自己就先改过盘）。 */
  const snapshotDisk = async (): Promise<string[]> => [
    await readFile(join(dir, "src", "a.ts"), "utf8"),
    await readFile(join(dir, "src", "b.ts"), "utf8"),
  ];
  const unchanged = async (): Promise<void> => {
    expect(await readFile(join(dir, "src", "a.ts"), "utf8")).toBe(A_ORIG);
    expect(await readFile(join(dir, "src", "b.ts"), "utf8")).toBe(B_ORIG);
  };

  it("正常应用：三处改动一次落地，内容与预期逐字相同", async () => {
    const r = await apply_patch.run({ patch: TWO_FILE_PATCH }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "a.ts"), "utf8")).toBe(
      ["line1", "LINE2", "line3", "line4", "LINE5", "line6"].join("\n") + "\n",
    );
    expect(await readFile(join(dir, "src", "b.ts"), "utf8")).toBe(
      ["alpha", "beta", "extra", "gamma"].join("\n") + "\n",
    );
  });

  it("行数读数取自 hunk 声明（与 git 同口径），并逐文件点名", async () => {
    const r = await apply_patch.run({ patch: TWO_FILE_PATCH }, ctx());
    expect(r.output).toContain("2 文件");
    expect(r.output).toContain("3 hunk");
    expect(r.output).toContain("+3 −2");
    expect(r.output).toContain("src/a.ts +2 −2");
    expect(r.output).toContain("src/b.ts +1 −0");
  });

  it("上下文漂移：报出是哪一段、第几行、期望什么、实际是什么", async () => {
    // 把 a.ts 的第 1 行改掉，补丁的上下文首行就对不上了
    await writeFile(join(dir, "src", "a.ts"), A_ORIG.replace("line1", "LINE-ONE-FRAME"), "utf8");
    const msg = await err(TWO_FILE_PATCH);
    expect(msg).toContain("src/a.ts 第 1 个 hunk");
    expect(msg).toContain("补丁第 4 行"); // TWO_FILE_PATCH 里 @@ 就在第 4 行
    expect(msg).toContain("声明旧侧第 1 行");
    expect(msg).toContain('"line1"'); // 期望
    expect(msg).toContain('"LINE-ONE-FRAME"'); // 实际
  });

  it("部分 hunk 失败 ⇒ 整笔不落盘（另一个文件也没被改，不是改到一半）", async () => {
    await writeFile(join(dir, "src", "a.ts"), A_ORIG.replace("line5", "line5-renamed"), "utf8");
    const before = await snapshotDisk();
    const msg = await err(TWO_FILE_PATCH);
    expect(msg).toContain("整笔未写盘");
    expect(msg).toContain("1 处不可应用");
    expect(await snapshotDisk()).toEqual(before); // b.ts 那处本可落地，也不许单独落
  });

  it("多处失败一次全报出来（一轮修完，不是修一处再撞下一处）", async () => {
    await writeFile(join(dir, "src", "a.ts"), A_ORIG.replace("line1", "X1"), "utf8");
    await writeFile(join(dir, "src", "b.ts"), B_ORIG.replace("beta", "NOPE"), "utf8");
    const msg = await err(TWO_FILE_PATCH);
    expect(msg).toContain("2 处不可应用");
    expect(msg).toContain("src/a.ts 第 1 个 hunk");
    expect(msg).toContain("src/b.ts 第 1 个 hunk");
    expect(await snapshotDisk()).toEqual([A_ORIG.replace("line1", "X1"), B_ORIG.replace("beta", "NOPE")]);
  });

  it("空补丁与纯空白都是拒收，不是「成功应用了 0 个文件」", async () => {
    expect(await err("")).toContain("补丁为空");
    expect(await err("   \n  \n")).toContain("补丁为空");
    expect(await err("commit abc123\n")).toContain("找不到任何 `diff --git` 段");
    await unchanged();
  });

  it("二进制段：明确拒绝并点名是哪个文件，整笔不落盘", async () => {
    const withBin = TWO_FILE_PATCH + "\n" + [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
    ].join("\n");
    const msg = await err(withBin);
    expect(msg).toContain("assets/logo.png");
    expect(msg).toContain("二进制");
    expect(msg).toContain("整笔未写盘");
    await unchanged();
  });

  it("删除与改名段：认得出来并拒绝（本工具只应用内容改动），不许静默跳过当成就没这一段", async () => {
    const del = [
      "diff --git a/src/b.ts b/src/b.ts",
      "deleted file mode 100644",
      "--- a/src/b.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-alpha",
      "-beta",
      "-gamma",
    ].join("\n");
    expect(await err(del)).toContain("要求删除文件");
    expect(await readFile(join(dir, "src", "b.ts"), "utf8")).toBe(B_ORIG);

    const ren = [
      "diff --git a/src/a.ts b/src/renamed.ts",
      "similarity index 100%",
      "rename from src/a.ts",
      "rename to src/renamed.ts",
    ].join("\n");
    expect(await err(ren)).toContain("要求改名/移动");
    expect(await readFile(join(dir, "src", "a.ts"), "utf8")).toBe(A_ORIG);
  });

  it("仅模式变更的段：不算失败，跳过并在回执里点名", async () => {
    const modeOnly = [
      "diff --git a/src/m.sh b/src/m.sh",
      "old mode 100644",
      "new mode 100755",
    ].join("\n");
    expect(await err(modeOnly)).toContain("没有可应用的内容改动");
    await unchanged();
  });

  it("路径越界与绝对路径一律拒绝（复用四道闸，不另立第二套）", async () => {
    const out = [
      "diff --git a/../escape.ts b/../escape.ts",
      "--- a/../escape.ts",
      "+++ b/../escape.ts",
      "@@ -0,0 +1,1 @@",
      "+x",
    ].join("\n");
    expect(await err(out)).toContain("越出 workspace 边界");
    const abs = [
      "diff --git a/x b//tmp/evil.ts",
      "--- a/x",
      "+++ b//tmp/evil.ts",
      "@@ -0,0 +1,1 @@",
      "+x",
    ].join("\n");
    expect(await err(abs)).toContain("只允许 workspace 相对路径");
    const agent = [
      "diff --git a/.agent/permissions.json b/.agent/permissions.json",
      "--- a/.agent/permissions.json",
      "+++ b/.agent/permissions.json",
      "@@ -0,0 +1,1 @@",
      "+{}",
    ].join("\n");
    expect(await err(agent)).toContain(".agent/ 是系统区");
  });

  it("新建文件成功；补丁说新建但盘上已有 ⇒ 拒绝（那是补丁过期，不是覆盖授权）", async () => {
    const create = [
      "diff --git a/src/c.ts b/src/c.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/c.ts",
      "@@ -0,0 +1,2 @@",
      "+export const c = 1;",
      "+",
    ].join("\n");
    const r = await apply_patch.run({ patch: create }, ctx());
    expect(r.ok).toBe(true);
    expect(r.change).toBe("created");
    expect(await readFile(join(dir, "src", "c.ts"), "utf8")).toBe("export const c = 1;\n\n");
    expect(await err(create)).toContain("已经存在");
  });

  it("行号漂移但内容唯一：照样落地，并在回执里报出偏差", async () => {
    await writeFile(join(dir, "src", "a.ts"), "inserted\n" + A_ORIG, "utf8");
    const r = await apply_patch.run({ patch: TWO_FILE_PATCH }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "a.ts"), "utf8")).toBe(
      ["inserted", "line1", "LINE2", "line3", "line4", "LINE5", "line6"].join("\n") + "\n",
    );
    expect(r.output).toContain("行号漂移");
  });

  it("上下文在窗口内匹配到多处 ⇒ 不猜，直接拒", async () => {
    const DUP = ["x", "same", "same", "y"].join("\n") + "\n";
    await writeFile(join(dir, "src", "dup.ts"), DUP, "utf8");
    const dup = [
      "diff --git a/src/dup.ts b/src/dup.ts",
      "--- a/src/dup.ts",
      "+++ b/src/dup.ts",
      "@@ -1,1 +1,1 @@",
      "-same",
      "+SAME",
    ].join("\n");
    const msg = await err(dup);
    expect(msg).toContain("无法唯一定位");
    expect(await readFile(join(dir, "src", "dup.ts"), "utf8")).toBe(DUP);
  });

  it("`\\ No newline at end of file` 打到文件末时真的不留换行", async () => {
    const noNewline = [
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -2,2 +2,2 @@",
      "-beta",
      "-gamma",
      "\\ No newline at end of file",
      "+BETA",
      "+GAMMA",
    ].join("\n");
    const r = await apply_patch.run({ patch: noNewline }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "b.ts"), "utf8")).toBe("alpha\nBETA\nGAMMA\n");

    const keep = [
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -2,2 +2,2 @@",
      "-BETA",
      "-GAMMA",
      "+beta",
      "+gamma",
      "\\ No newline at end of file",
    ].join("\n");
    expect((await apply_patch.run({ patch: keep }, ctx())).ok).toBe(true);
    expect(await readFile(join(dir, "src", "b.ts"), "utf8")).toBe("alpha\nbeta\ngamma");
  });

  it("报错正文有界：几十处失败也不会把上下文面撑爆（与 edit_file 同纪律）", async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      [
        `diff --git a/src/f${String(i)}.ts b/src/f${String(i)}.ts`,
        `--- a/src/f${String(i)}.ts`,
        `+++ b/src/f${String(i)}.ts`,
        "@@ -1,1 +1,1 @@",
        "-absent-line",
        "+whatever",
      ].join("\n"),
    ).join("\n");
    const msg = await err(many);
    expect(msg).toContain("40 处不可应用");
    expect(msg).toContain("另有 20 处未列");
    expect(msg.length).toBeLessThan(6000);
    await unchanged();
  });

  it("新建文件的父目录不存在 ⇒ 建目录后落地（真数据探针在 138 笔上撞到的就是这一条）", async () => {
    const nested = [
      "diff --git a/src/deep/new/mod.ts b/src/deep/new/mod.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/deep/new/mod.ts",
      "@@ -0,0 +1,1 @@",
      "+export const mod = 1;",
    ].join("\n");
    const r = await apply_patch.run({ patch: nested }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "deep", "new", "mod.ts"), "utf8")).toBe("export const mod = 1;\n");
  });

  it("补丁正文超上限 ⇒ 拒收（入参无界就是上下文面无界）", async () => {
    const huge = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-line1\n+" + "z".repeat(300 * 1024);
    expect(await err(huge)).toContain("超过 256KB 上限");
    await unchanged();
  });

  it("覆盖前快照排在「不可应用」那道拒绝之后：失败一笔都不留，成功才留原件", async () => {
    const snapCtx = (): ToolContext => ({ workspace: dir, emit: async () => {}, callId: "call-1" });
    await writeFile(join(dir, "src", "a.ts"), A_ORIG.replace("line1", "X1"), "utf8");
    await apply_patch.run({ patch: TWO_FILE_PATCH }, snapCtx()).catch(() => {});
    expect(await readdir(join(dir, ".agent", "snapshots")).catch(() => [] as string[])).toEqual([]);

    await writeFile(join(dir, "src", "a.ts"), A_ORIG, "utf8");
    const r = await apply_patch.run({ patch: TWO_FILE_PATCH }, snapCtx());
    expect(r.ok).toBe(true);
    expect(r.snapshotId).toBeTruthy();
    expect(await readdir(join(dir, ".agent", "snapshots"))).not.toEqual([]);
  });
});
