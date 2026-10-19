// M2 · apply_patch 的判卷（PLAN §M2：正常应用 / 上下文漂移 / 部分 hunk 失败 / 空补丁 / 二进制拒）。
// 分成两层：`patch-parse.ts` 是纯函数（零 IO，可离线判卷）；`apply_patch.ts` 只负责把计划落到盘上，
// 并把仓里已有的四道路径闸、覆盖前快照、写后诊断、影响面回注全部复用过来——本工具不许另立第二套写盘纪律。
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parsePatch, PatchParseError } from "../src/tools/patch-parse";
import { apply_patch } from "../src/tools/apply_patch";
import { ToolError, type ToolContext } from "../src/tools/base";

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

  // ---- 2026-10-19：**多给**也是坏补丁（与上面的收不满对称）----
  // 旧代码只在收不满时出声。多给时它在"收满"那一刻把 hunk 置 null，随后静默丢掉
  // 后面的 `-old` / `+new` ⇒ parsePatch 返回成功，而 hunk 只剩上下文行 ⇒ 应用后文件
  // **原样写回**、回执却报 ok:true「已应用补丁」。实测 `git apply` 对同一份输入报
  // `error: corrupt patch`。半应用比不应用更坏：模型被告知补丁落地了，文件却纹丝不动。
  it("hunk 声明行数**少于**实际给的（多给）⇒ 同样报错，不许静默丢掉多出的正文行", () => {
    const oversupplied = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      " keep",
      "-old",
      "+new",
    ].join("\n");
    expect(() => parsePatch(oversupplied)).toThrow(PatchParseError);
    expect(() => parsePatch(oversupplied)).toThrow(/已收满|声明的行数/u);
  });

  it("反向验证：多给被静默丢掉时，应用结果 = 文件原样 + 回执却报成功（现造旧后果）", () => {
    // 旧行为读出来的 hunk 只有上下文行 ⇒ apply 后文件一字不改，而 ok 仍是 true。
    // 把那个"解析结果"现造出来钉住它的坏：hunk 里没有 -/+ 行，就等于什么都没改。
    const oversupplied = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      " keep",
      "-old",
      "+new",
    ].join("\n");
    // 修好之后：连解析都过不去 ⇒ 后面的"静默不改"根本没有发生的机会。
    expect(() => parsePatch(oversupplied)).toThrow(PatchParseError);
  });

  it("收满后紧跟新段头**不**算多给（两个文件的补丁照常解析）", () => {
    // 声明要写对：1 行上下文 + 1 行新增 ⇒ 旧侧 1、**新侧 2**。写成 `+1,1` 就是上面那条
    // 多给（实测 `git apply` 同样报 corrupt patch）——这条钉的是"声明正确时不该被误伤"。
    const twoFiles = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,2 @@",
      " keep",
      "+new",
      "diff --git b/b.ts b/b.ts",
      "--- b/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,2 @@",
      " B1",
      "+B1X",
    ].join("\n");
    const files = parsePatch(twoFiles);
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(files[0]!.hunks[0]!.lines).toEqual([{ mark: " ", text: "keep" }, { mark: "+", text: "new" }]);
  });

  it("ctx+add 却把新侧声明少写一格（`+1,1` 配 上下文+新增）⇒ 同样红，这是最后一条正文即多给", () => {
    // 本笔第一版守卫看的是"下一行"，于是这个形态漏检：收满的瞬间手里正是 `+new`，
    // 而下一行是段头。改成看**当前行**才抓住（实测踩过，注释里留了记号）。
    const underDeclared = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      " keep",
      "+new",
    ].join("\n");
    expect(() => parsePatch(underDeclared)).toThrow(PatchParseError);
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

  // 纯新增 hunk 的落点：`@@ -N,0 +M @@` 的 N 是「插在旧文件第 N 行**之后**」（git 口径），
  // 所以 0-based 落点是 N，不是 N-1。旧实现按 N-1 插，于是每一次中间插入都整体早一行，
  // 往文件尾追加时甚至插到末行之前——而回执照报 `ok: true`：静默改错地方比改不动危险得多。
  // 反向锚点：拿 `@@ -0,0`（新建）当判据是空绿的，两式在那一格都落到 0。
  it("纯新增 hunk 落在声明行**之后**，不是之前（-U0 补丁逐字对齐 git apply）", async () => {
    const orig = ["a", "b", "c", "d", "e"].join("\n") + "\n";
    await writeFile(join(dir, "src", "ins.ts"), orig, "utf8");
    const r = await apply_patch.run({ patch: [
      "diff --git a/src/ins.ts b/src/ins.ts",
      "--- a/src/ins.ts",
      "+++ b/src/ins.ts",
      "@@ -2,0 +3 @@",
      "+NEW",
    ].join("\n") }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "ins.ts"), "utf8")).toBe(
      ["a", "b", "NEW", "c", "d", "e"].join("\n") + "\n",
    );
  });

  it("往文件尾追加：插在末行之后，不是抢在末行之前", async () => {
    await writeFile(join(dir, "src", "tail.ts"), ["a", "b"].join("\n") + "\n", "utf8");
    const r = await apply_patch.run({ patch: [
      "diff --git a/src/tail.ts b/src/tail.ts",
      "--- a/src/tail.ts",
      "+++ b/src/tail.ts",
      "@@ -2,0 +3 @@",
      "+c",
    ].join("\n") }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "tail.ts"), "utf8")).toBe(["a", "b", "c"].join("\n") + "\n");
  });

  it("两段 -U0 新增互不牵连（前一段落点不把后一段的行号带偏）", async () => {
    await writeFile(join(dir, "src", "two.ts"), ["a", "b", "c", "d", "e"].join("\n") + "\n", "utf8");
    const r = await apply_patch.run({ patch: [
      "diff --git a/src/two.ts b/src/two.ts",
      "--- a/src/two.ts",
      "+++ b/src/two.ts",
      "@@ -2,0 +3 @@",
      "+X",
      "@@ -4,0 +6 @@",
      "+Y",
    ].join("\n") }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "two.ts"), "utf8")).toBe(
      ["a", "b", "X", "c", "d", "Y", "e"].join("\n") + "\n",
    );
  });

  it("纯新增声明行越界 ⇒ 拒（不把「插不进去」折成插到文件末尾）", async () => {
    await writeFile(join(dir, "src", "oob.ts"), ["a", "b"].join("\n") + "\n", "utf8");
    const msg = await err([
      "diff --git a/src/oob.ts b/src/oob.ts",
      "--- a/src/oob.ts",
      "+++ b/src/oob.ts",
      "@@ -99,0 +100 @@",
      "+z",
    ].join("\n"));
    expect(msg).toContain("上下文对不上");
    expect(await readFile(join(dir, "src", "oob.ts"), "utf8")).toBe(["a", "b"].join("\n") + "\n");
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

  // 上面那条只覆盖「补丁带了 `\ No newline` 标记」的形状。**不带标记**那一族才是真缺口：
  // 旧实现在覆盖 EOF 时只用 `!newNoNewline` 推结果，而手写/别处抄来的补丁压根没有这个标记
  // ⇒ 一个本来没有行尾换行的文件被强加 `\n`。判据钉的是 git apply 的真值（实测两种补丁）：
  //   · 结果无换行 ⇒ 标记跟在**新侧**末行后；结果有换行而原文件没有 ⇒ 标记跟在**旧侧**末行后。
  //   所以 `oldNoNewline` 不决定结果形状；新侧没标记时**保持原文件**，不替用户决定。
  it("补丁不带 `\\ No newline`：原文件没有行尾换行就保持没有（不替用户强加）", async () => {
    await writeFile(join(dir, "src", "nn.ts"), "a\nb\nc", "utf8"); // 末行无换行
    const r = await apply_patch.run({ patch: [
      "diff --git a/src/nn.ts b/src/nn.ts",
      "--- a/src/nn.ts",
      "+++ b/src/nn.ts",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
    ].join("\n") }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "nn.ts"), "utf8")).toBe("a\nB\nc");
  });

  it("补丁不带 `\\ No newline`：原文件有行尾换行就保持有（反向锚点，不许一刀切）", async () => {
    await writeFile(join(dir, "src", "yn.ts"), "a\nb\nc\n", "utf8"); // 末行有换行
    const r = await apply_patch.run({ patch: [
      "diff --git a/src/yn.ts b/src/yn.ts",
      "--- a/src/yn.ts",
      "+++ b/src/yn.ts",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
    ].join("\n") }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "yn.ts"), "utf8")).toBe("a\nB\nc\n");
  });

  it("整文件重写且原文件无行尾换行 ⇒ 重写后仍然没有", async () => {
    await writeFile(join(dir, "src", "whole.ts"), "a\nb\nc\nd\ne", "utf8");
    const r = await apply_patch.run({ patch: [
      "diff --git a/src/whole.ts b/src/whole.ts",
      "--- a/src/whole.ts",
      "+++ b/src/whole.ts",
      "@@ -1,5 +1,5 @@",
      " a",
      " b",
      " c",
      " d",
      "-e",
      "+E",
    ].join("\n") }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "whole.ts"), "utf8")).toBe("a\nb\nc\nd\nE");
  });

  it("新建文件仍以行尾换行结尾（--- /dev/null 没有原文件可保持，git 同口径）", async () => {
    const r = await apply_patch.run({ patch: [
      "diff --git a/src/created.ts b/src/created.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/created.ts",
      "@@ -0,0 +1,2 @@",
      "+export const c = 1;",
      "+",
    ].join("\n") }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "src", "created.ts"), "utf8")).toBe("export const c = 1;\n\n");
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

/** rename 失败注入点（必须活在模块顶层：`vi.mock` 的工厂被提升，引用不到 describe 内的绑定）。 */
const failRenameOn = { target: "" };
/** 回滚写回也失败的目标（制造「没能恢复」那一格，用来判恢复指引不说空话）。
 *  **只在 rename 已经开始失败之后生效**：预写阶段也走 writeFile，不设这道闸就会错失败在预写，
 *  那一格另一个用例已经判过，这里要的是第二阶段。 */
const failRollbackOn = { target: "", armed: false };
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      // 只对**目标路径**命中失败一次：第一个文件落盘成功，第二个失败 ⇒ 必须回滚第一个。
      if (String(args[1]) === failRenameOn.target) {
        failRenameOn.target = "";
        throw Object.assign(new Error("注入的 rename 失败"), { code: "EACCES" });
      }
      return fs.rename(...args);
    },
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      if (failRollbackOn.armed && String(args[0]) === failRollbackOn.target) {
        throw Object.assign(new Error("注入的回滚写回失败"), { code: "EACCES" });
      }
      return fs.writeFile(...args);
    },
  };
});

/** 多文件写入的原子性（旧实现：逐文件 writeFile，第 N 个失败时前 N-1 个已在盘上，
 *  且抛的是裸 fs 错误——「整笔未写盘」这句承诺在这一格是假的）。 */
describe("apply_patch 多文件原子性", () => {
  const PATCH = [
    "diff --git a/a.txt b/a.txt", "--- a/a.txt", "+++ b/a.txt",
    "@@ -1,2 +1,2 @@", "-A1", "+A1X", " a2",
    "diff --git a/b.txt b/b.txt", "--- a/b.txt", "+++ b/b.txt",
    "@@ -1,2 +1,2 @@", "-B1", "+B1X", " b2",
    "diff --git a/c.txt b/c.txt", "--- a/c.txt", "+++ b/c.txt",
    "@@ -1,2 +1,2 @@", "-c1", "+c1X", " c2",
  ].join("\n") + "\n";

  async function setup(): Promise<{ dir: string; ctx: () => ToolContext }> {
    const dir = await mkdtemp(join(tmpdir(), "apply-patch-atomic-"));
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, "a.txt"), "A1\na2\n", "utf8");
    await writeFile(join(dir, "b.txt"), "B1\nb2\n", "utf8");
    await writeFile(join(dir, "c.txt"), "c1\nc2\n", "utf8");
    return { dir, ctx: () => ({ workspace: dir, emit: async () => {}, snapshot: false }) };
  }

  it("rename 中途失败：已落盘的被回滚，其余从没落盘，且报的是 ToolError 而不是裸 fs 错误", async () => {
    const { dir, ctx } = await setup();
    failRenameOn.target = join(dir, "b.txt"); // 第一个（a.txt）落盘成功，第二个失败
    let err: unknown;
    try {
      await apply_patch.run({ patch: PATCH }, ctx());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ToolError);
    const msg = (err as Error).message;
    // 回执必须说得出「谁回滚了、整笔没落盘」——模型要靠这句话决定下一步，而不是看到一句 EACCES
    expect(msg).toContain("b.txt");
    expect(msg).toContain("已回滚 1 个");
    expect(msg).toContain("整笔未写盘");
    // 关键格：第一个文件被恢复到改动前
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("A1\na2\n");
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("B1\nb2\n");
    expect(await readFile(join(dir, "c.txt"), "utf8")).toBe("c1\nc2\n");
    // 临时文件一个都不许留在盘上
    expect(await readdir(dir)).toEqual([".agent", "a.txt", "b.txt", "c.txt"]);
  });

  // 恢复不了那一格：回执要指路，但**只指确实存在的路**。没有快照（这里 snapshot: false）时说
  // 「用覆盖前快照取回」是空头承诺——模型照做会发现没有那份原件，白绕一圈。
  it("回滚也失败时：没有快照就不拿快照指路（不说空话）", async () => {
    const { dir, ctx } = await setup();
    failRenameOn.target = join(dir, "b.txt"); // a.txt 落盘后，b.txt 失败
    failRollbackOn.target = join(dir, "a.txt"); // 回滚 a.txt 时也失败 ⇒ stuck 非空
    failRollbackOn.armed = true;
    let err: unknown;
    try {
      await apply_patch.run({ patch: PATCH }, ctx());
    } catch (e) {
      err = e;
    } finally {
      failRollbackOn.armed = false;
    }
    expect(err).toBeInstanceOf(ToolError);
    const msg = (err as Error).message;
    expect(msg).toContain("没能恢复");
    expect(msg).toContain("a.txt");
    // 关键格：没有快照 ⇒ 指 git，且**不许**出现快照路径这种指不到的东西
    expect(msg).toContain("本轮没有覆盖前快照");
    expect(msg).toContain("请走 git 取回");
    expect(msg).not.toContain("请用覆盖前快照取回（");
  });

  it("预写阶段失败：目标文件一个都没碰（整笔未写盘的字面意思）", async () => {
    const { dir, ctx } = await setup();
    // 把目录撤成只读：临时文件建不起来 ⇒ 在动任何目标之前就失败
    await import("node:fs/promises").then((fs) => fs.chmod(dir, 0o555));
    try {
      let err: unknown;
      try {
        await apply_patch.run({ patch: PATCH }, ctx());
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ToolError);
      expect((err as Error).message).toContain("目标文件一个都没有改动");
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("A1\na2\n");
      expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("B1\nb2\n");
      expect(await readFile(join(dir, "c.txt"), "utf8")).toBe("c1\nc2\n");
    } finally {
      await import("node:fs/promises").then((fs) => fs.chmod(dir, 0o755));
    }
  });

  it("全部顺利时：多文件一次落盘，回执与逐文件读数不变（不因原子化改造回归）", async () => {
    const { dir, ctx } = await setup();
    const r = await apply_patch.run({ patch: PATCH }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("A1X\na2\n");
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("B1X\nb2\n");
    expect(await readFile(join(dir, "c.txt"), "utf8")).toBe("c1X\nc2\n");
    expect(r.output).toContain("3 文件");
    expect(await readdir(dir)).toEqual([".agent", "a.txt", "b.txt", "c.txt"]);
  });
});

// 2026-10-19 独立评审追出的补丁层缺陷（每条都先复现再修）。
describe("apply_patch：同路径多段 / 引号路径 / 非 UTF-8 / EOF 换行 / 正文撞表头", () => {
  let dir: string;
  const ctx = (): ToolContext => ({ workspace: dir, emit: async () => {}, snapshot: false });
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "apply-patch-edge-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it("同一路径拆成两段：整笔拒绝（旧行为静默丢掉前一段）", async () => {
    await writeFile(join(dir, "d.txt"), "one\ntwo\nthree\n", "utf8");
    const patch = [
      "diff --git a/d.txt b/d.txt",
      "--- a/d.txt",
      "+++ b/d.txt",
      "@@ -1,1 +1,1 @@",
      "-one",
      "+ONE",
      "diff --git a/d.txt b/d.txt",
      "--- a/d.txt",
      "+++ b/d.txt",
      "@@ -3,1 +3,1 @@",
      "-three",
      "+THREE",
    ].join("\n");
    await expect(apply_patch.run({ patch }, ctx())).rejects.toThrow(/同一路径/);
    expect(await readFile(join(dir, "d.txt"), "utf8")).toBe("one\ntwo\nthree\n");
  });

  it("git 的 C 风格引号路径要解码（非 ASCII 新建不会写成字面量反斜杠名）", async () => {
    const patch = [
      'diff --git "a/\\346\\226\\260\\346\\226\\207\\344\\273\\266.md" "b/\\346\\226\\260\\346\\226\\207\\344\\273\\266.md"',
      "new file mode 100644",
      "--- /dev/null",
      '+++ "b/\\346\\226\\260\\346\\226\\207\\344\\273\\266.md"',
      "@@ -0,0 +1,1 @@",
      "+hello",
    ].join("\n");
    const r = await apply_patch.run({ patch }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "新文件.md"), "utf8")).toBe("hello\n");
    expect(await readdir(dir)).toEqual(["新文件.md"]);
  });

  it("EOF：旧侧标记「无行尾换行」+ 新侧无标记 ⇒ 结果为有换行（与 git apply 同向）", async () => {
    await writeFile(join(dir, "e.txt"), "old", "utf8");
    const patch = [
      "diff --git a/e.txt b/e.txt",
      "--- a/e.txt",
      "+++ b/e.txt",
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
    ].join("\n");
    await apply_patch.run({ patch }, ctx());
    expect(await readFile(join(dir, "e.txt"), "utf8")).toBe("new\n");
  });

  it("删除以 `-- ` 开头的正文行（补丁里是 `--- `）不被当成文件头", async () => {
    await writeFile(join(dir, "s.sql"), "select 1;\n-- a comment\nselect 2;\n", "utf8");
    const patch = [
      "diff --git a/s.sql b/s.sql",
      "--- a/s.sql",
      "+++ b/s.sql",
      "@@ -1,3 +1,2 @@",
      " select 1;",
      "--- a comment",
      " select 2;",
    ].join("\n");
    const r = await apply_patch.run({ patch }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "s.sql"), "utf8")).toBe("select 1;\nselect 2;\n");
  });

  it("段间与末尾空行不制造「声明行数少于实际给的」误报", async () => {
    await writeFile(join(dir, "a.txt"), "a\n", "utf8");
    await writeFile(join(dir, "b.txt"), "b\n", "utf8");
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+A",
      "",
      "diff --git a/b.txt b/b.txt",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -1,1 +1,1 @@",
      "-b",
      "+B",
      "",
    ].join("\n");
    const r = await apply_patch.run({ patch }, ctx());
    expect(r.ok).toBe(true);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("A\n");
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("B\n");
  });

  it("非 UTF-8 文件拒绝改写（旧行为把非法字节换成 U+FFFD）", async () => {
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x6c, 0x69, 0x6e, 0x65, 0x32, 0x0a]);
    await writeFile(join(dir, "latin1.txt"), bytes);
    const patch = [
      "diff --git a/latin1.txt b/latin1.txt",
      "--- a/latin1.txt",
      "+++ b/latin1.txt",
      "@@ -2,1 +2,1 @@",
      "-line2",
      "+LINE2",
    ].join("\n");
    await expect(apply_patch.run({ patch }, ctx())).rejects.toThrow(/不是合法 UTF-8/);
    expect(await readFile(join(dir, "latin1.txt"))).toEqual(bytes);
  });

  it("内容补丁保留原文件模式；同时带 new mode 时按补丁改", async () => {
    const p = join(dir, "run.sh");
    await writeFile(p, "echo old\n", "utf8");
    await import("node:fs/promises").then((fs) => fs.chmod(p, 0o755));
    const base = [
      "diff --git a/run.sh b/run.sh",
      "--- a/run.sh",
      "+++ b/run.sh",
      "@@ -1,1 +1,1 @@",
      "-echo old",
      "+echo new",
    ].join("\n");
    await apply_patch.run({ patch: base }, ctx());
    expect((await import("node:fs/promises").then((fs) => fs.stat(p))).mode & 0o777).toBe(0o755);

    const withMode = [
      "diff --git a/run.sh b/run.sh",
      "old mode 100755",
      "new mode 100644",
      "--- a/run.sh",
      "+++ b/run.sh",
      "@@ -1,1 +1,1 @@",
      "-echo new",
      "+echo newer",
    ].join("\n");
    await apply_patch.run({ patch: withMode }, ctx());
    expect((await import("node:fs/promises").then((fs) => fs.stat(p))).mode & 0o777).toBe(0o644);
  });
});

describe("新建文件的 new file mode（2026-10-19 自审）", () => {
  it("`new file mode 100755` 要落到可执行位", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-patch-mode-"));
    try {
      const patch = [
        "diff --git a/run.sh b/run.sh",
        "new file mode 100755",
        "--- /dev/null",
        "+++ b/run.sh",
        "@@ -0,0 +1,1 @@",
        "+#!/bin/sh",
      ].join("\n");
      const r = await apply_patch.run({ patch }, { workspace: dir, emit: async () => {}, snapshot: false });
      expect(r.ok).toBe(true);
      const st = await import("node:fs/promises").then((fs) => fs.stat(join(dir, "run.sh")));
      expect(st.mode & 0o777).toBe(0o755);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
