// 能力 2 · apply_patch「补丁不完整」回执的定位与下一步（判卷）。
//
// 动因是留档轨迹里那一格（`outputs/tool-choice-receipt-2026-10-04/attempt1-summary-only/events/
// pruned-grep-target.jsonl` 第 21/24/27 条）：回执只报「声明几行／实收几行」，模型收到后连着 4 次
// 重发同一笔补丁、一次也没落盘——因为它分不清这是"补丁自身少抄了行"还是"行号跟盘面对不上"，
// 于是去改 `@@` 的数字（第 20→23→26 条正是三次改数字）。本面钉的是回执**追加**的那半句：
// 指名哪一段第几个 hunk、两侧各差几行、正文抄到第几行停、停手处紧跟什么、下一步做什么。
//
// 判卷分两层（沿用 `apply-patch.test.ts` 的分法）：`patch-parse.ts` 是纯函数层，逐字段钉；
// 工具层只钉**调用后的可观测结果**（回执文本 + 整笔未写盘），不钉字面常量——锚点文字与被测实现
// 同处一文件时 `toContain(那段文字)` 是恒真的，所以这里的 `toContain` 一律读运行时的 message。
// 反向守卫成对：正常补丁、盘面不匹配（另一种失败）、单段单 hunk 三种场合都必须闭嘴。
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatTruncationGuidance,
  parsePatch,
  PatchParseError,
  type PatchTruncation,
} from "../src/tools/patch-parse";
import { apply_patch } from "../src/tools/apply_patch";
import type { ToolContext } from "../src/tools/base";

/** 逐字取自留档轨迹第 20 条那次调用（28 行补丁，`@@ -14,12 +14,21 @@` 声明、实收 11/19）：
 *  这一格的价值在于"尺吃的是真料"——判的差额 1/2 与"补丁就到第 28 行"都是那条回执里的原数。 */
const TRACE_PATCH =
  [
    "diff --git a/src/pricing.js b/src/pricing.js", // 1
    "--- a/src/pricing.js", // 2
    "+++ b/src/pricing.js", // 3
    "@@ -14,12 +14,21 @@ export function tierOf(kg) {", // 4
    " }", // 5  上下文
    "", // 6  上下文（空行）
    " /**", // 7  上下文
    "- * 算总价。BUG：跨档位时把**每一公斤**都按最终档位的单价算，", // 8
    "- * 于是 30 公斤全被当成 20 公斤档（12 元/公斤），少收一大截。", // 9
    "+ * 算总价。跨档位要**分段累加**：", // 10
    "+ * 每一档只按落入该档的公斤数计价，而不是整单按最终档的单价算。", // 11
    "+ * 例：total(8) = 1×18 + 4×15 + 3×12 = 114。", // 12
    " */", // 13 上下文
    " export function total(kg) {", // 14 上下文
    "-  const t = tierOf(kg);", // 15
    "-  if (!t) return Infinity;", // 16
    "-  return kg * t.perKg;", // 17
    "+  if (!tierOf(kg)) return Infinity;", // 18
    "+  let sum = 0;", // 19
    "+  let lower = 0;", // 20
    "+  for (const t of TIERS) {", // 21
    "+    if (kg <= lower) break;", // 22
    "+    const kgInTier = Math.min(kg, t.maxKg) - lower;", // 23
    "+    sum += kgInTier * t.perKg;", // 24
    "+    lower = t.maxKg;", // 25
    "+  }", // 26
    "+  return sum;", // 27
    " }", // 28 上下文 ⇒ 旧侧 6+5=11／新侧 6+13=19，与那条回执逐字同数
  ].join("\n") + "\n";

/** 抛错并交出 message（判的是运行时文本，不是源文件里的字面）。 */
const parseErr = (patch: string): PatchParseError => {
  try {
    parsePatch(patch);
  } catch (e) {
    if (e instanceof PatchParseError) return e;
    throw e;
  }
  throw new Error("这条补丁本该被判成截断，却解析成功了");
};

describe("截断定位：纯函数层逐字段钉（不碰盘、不起进程）", () => {
  it("留档形状（尾部被截）⇒ 既有那句逐字保留，其后追加定位与下一步", () => {
    const msg = parseErr(TRACE_PATCH).message;
    // ① 只追加：按文案匹配的老账（failure-face 那张簇表）钉的是这半句，它一个字都不许动。
    expect(msg).toContain("hunk 声明 -14,12 +14,21，实收旧侧 11 行／新侧 19 行（补丁不完整）（补丁第 4 行）");
    // ② 指名到段／到 hunk／到两侧各自的差额。
    expect(msg).toContain("src/pricing.js 第 1/1 个 hunk");
    expect(msg).toContain("旧侧声明 12 行／实收 11 行（少抄 1 行）");
    expect(msg).toContain("新侧声明 21 行／实收 19 行（少抄 2 行）");
    // ③ 抄到哪儿停的 + 停手处的形状（这条是模型从前完全看不见的信息）。
    expect(msg).toContain("正文止于补丁第 28 行");
    expect(msg).toContain('"+  return sum;"');
    expect(msg).toContain("补丁到第 28 行就发完了");
    expect(msg).toContain("尾部被截");
    // ④ 先破掉那个错误归因（轨迹里模型就是把它当成行号问题去改 @@ 数字）。
    //    这两段逐字引自回执——`tests/promise-recall-inventory.test.ts` 那把"能力断言要有证人"的尺
    //    按**整段连续中文（≥6 字）**配对，把这句拆成"还没跟盘上的内容对照"这种半段会让证人面读成没人判过。
    expect(msg).toContain("这一步还没跟盘上的内容对照");
    expect(msg).toContain("改行号不会有用");
    // ⑤ 下一步：只重发这一段，且明令不许改小声明数字（改小＝该删的行留在盘上）。
    expect(msg).toContain("别整笔重发");
    expect(msg).toContain("不能把 @@ 的声明数字改小");
    // ⑥ 反向：单段补丁不该替别的段许愿。
    expect(msg).not.toContain("本轮还没查到");
  });

  it("结构化字段（判卷钉字段，不钉文案拼法）", () => {
    const t = parseErr(TRACE_PATCH).truncation;
    expect(t).toMatchObject({
      path: "src/pricing.js",
      fileSeq: 1,
      fileCount: 1,
      hunkSeq: 1,
      hunksInFile: 1,
      declaredAt: 4,
      oldStart: 14,
      oldCount: 12,
      newStart: 14,
      newCount: 21,
      receivedOld: 11,
      receivedNew: 19,
      deltaOld: 1,
      deltaNew: 2,
      bodyEndLine: 28,
      tail: ["+  return sum;", " }"],
      after: "patch-end",
      afterLine: 0,
      afterText: "",
      patchLines: 28,
    });
    // 回执就是从这份读数渲染的（同一事实源，两处不许漂）。
    expect(parseErr(TRACE_PATCH).message).toContain(formatTruncationGuidance(t as PatchTruncation));
  });

  it("中段截（下一段的表头就紧跟其后）⇒ 点名缺的行在本段末尾，并如实报还有几段没查", () => {
    const mid = [
      "diff --git a/src/a.ts b/src/a.ts", // 1
      "--- a/src/a.ts", // 2
      "+++ b/src/a.ts", // 3
      "@@ -1,3 +1,3 @@", // 4
      " keep", // 5
      "-old", // 6
      "+new", // 7
      "diff --git a/src/b.ts b/src/b.ts", // 8
      "--- a/src/b.ts", // 9
      "+++ b/src/b.ts", // 10
      "@@ -1,1 +1,1 @@", // 11
      "-x", // 12
      "+y", // 13
    ].join("\n");
    const msg = parseErr(mid).message;
    expect(msg).toContain("src/a.ts 第 1/1 个 hunk");
    expect(msg).toContain("正文止于补丁第 7 行");
    expect(msg).toContain("其后第 8 行已是下一段的表头");
    expect(msg).toContain("缺的行在本段末尾，下一段没受影响");
    expect(msg).toContain("本笔共 2 段，其后 1 段本轮还没查到");
    expect(msg).not.toContain("补丁到第");
    expect(parseErr(mid).truncation).toMatchObject({ fileSeq: 1, fileCount: 2, after: "header", afterLine: 8 });
  });

  it("丢了前导标记 ⇒ 指名那一行没被算进正文并给出标记图例（这一族从前只报计数差）", () => {
    const stripped = [
      "diff --git a/src/a.ts b/src/a.ts", // 1
      "--- a/src/a.ts", // 2
      "+++ b/src/a.ts", // 3
      "@@ -1,4 +1,3 @@", // 4
      " keep", // 5
      "-old", // 6
      "+new", // 7
      "}", // 8 ⇒ 上下文行漏了前导空格，解析器在此收手
    ].join("\n");
    const msg = parseErr(stripped).message;
    expect(msg).toContain('其后第 8 行没被算进本段正文（"}"）');
    expect(msg).toContain("丢了前导标记");
    expect(msg).toContain("上下文行前一个空格、新增行前 +、删除行前 -");
    expect(msg).not.toContain("已是下一段的表头");
    expect(parseErr(stripped).truncation).toMatchObject({ after: "unparsed", afterLine: 8, deltaOld: 2, deltaNew: 1 });
  });

  it("实收比声明多 ⇒ 说「多算」并换成核对声明的下一步，绝不劝人补行", () => {
    const over = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,3 @@", // 旧侧声明 1 行，正文却给了 3 行上下文
      " a",
      " b",
      " c",
    ].join("\n");
    const msg = parseErr(over).message;
    expect(msg).toContain("旧侧声明 1 行／实收 3 行（多算 2 行）");
    expect(msg).toContain("新侧声明 3 行／实收 3 行（收满）");
    expect(msg).toContain("核对 @@ 的四个数字与正文边界");
    expect(msg).not.toContain("少抄");
    expect(msg).not.toContain("不能把 @@ 的声明数字改小");
    expect(parseErr(over).truncation).toMatchObject({ deltaOld: -2, deltaNew: 0 });
  });

  it("正文一行都没收到（@@ 之后就是别的内容）⇒ 指到 @@ 的下一行，不编造边界", () => {
    const empty = [
      "diff --git a/src/a.ts b/src/a.ts", // 1
      "--- a/src/a.ts", // 2
      "+++ b/src/a.ts", // 3
      "@@ -1,2 +1,2 @@", // 4
      "index 1111111..2222222 100644", // 5 ⇒ 表头，一段正文都没给
    ].join("\n");
    const msg = parseErr(empty).message;
    expect(msg).toContain("本段正文一行都没收到（@@ 之后第 5 行起就不是这一段的内容）");
    expect(msg).toContain("少抄 2 行");
    expect(parseErr(empty).truncation).toMatchObject({ bodyEndLine: 4, tail: [], after: "header", afterLine: 5 });
  });

  it("回执自己有界：5000 字符的正文行也裁到 100 字符（报错文本不能把上下文面撑爆）", () => {
    const huge = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-old",
      "+" + "z".repeat(5000),
    ].join("\n");
    const msg = parseErr(huge).message;
    const run = (msg.match(/z+/) ?? [""])[0];
    // 裁而不是丢：整段消失也是一种"回执有界"，但模型就看不见补丁被切在哪一行了。
    expect(run.length, "超长正文行必须被裁（5000 字符不许整条进回执）").toBeLessThan(120);
    expect(run.length, "被裁的行仍要点名，不许直接不报正文").toBeGreaterThanOrEqual(90);
    expect(msg).not.toContain("z".repeat(200));
    expect(msg.length).toBeLessThan(1500);
  });

  it("反向守卫：带引号与制表符的**完整**补丁照旧解析成功，一个新字都不出声", () => {
    const quoted = [
      "diff --git a/src/q.ts b/src/q.ts",
      "--- a/src/q.ts",
      "+++ b/src/q.ts",
      "@@ -1,3 +1,3 @@",
      " const s = \"say \\\"hi\\\"\";",
      "-\tif (s) return;",
      "+\tif (!s) return;",
      " }",
    ].join("\n");
    const files = parsePatch(quoted);
    expect(files[0].hunks[0].lines.map((l) => l.mark)).toEqual([" ", "-", "+", " "]);
    expect(files[0].hunks[0].bodyEndLine).toBe(8);
    expect(() => parsePatch(quoted)).not.toThrow();
  });
});

describe("apply_patch 工具面：接线之后模型真正读到的那一格", () => {
  let dir: string;
  const ctx = (): ToolContext => ({ workspace: dir, emit: async () => {}, snapshot: false });
  const A_ORIG = ["line1", "line2", "line3"].join("\n") + "\n";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "apply-patch-trunc-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), A_ORIG, "utf8");
    await writeFile(join(dir, "src", "pricing.js"), "export const TIERS = [];\n", "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const runErr = async (patch: string): Promise<string> => {
    try {
      const r = await apply_patch.run({ patch }, ctx());
      return r.ok ? "" : r.output;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  it("截断补丁经工具面：回执带定位，且整笔未写盘（退出路径与 ok 一律照旧）", async () => {
    const msg = await runErr(TRACE_PATCH);
    expect(msg).toContain("apply_patch: ");
    expect(msg).toContain("hunk 声明 -14,12 +14,21");
    expect(msg).toContain("截断定位");
    expect(msg).toContain("src/pricing.js 第 1/1 个 hunk");
    expect(await readFile(join(dir, "src", "pricing.js"), "utf8")).toBe("export const TIERS = [];\n");
    expect(await readFile(join(dir, "src", "a.ts"), "utf8")).toBe(A_ORIG);
  });

  it("反向守卫：单 hunk、旧侧逐字对不上（那是盘面的事，不是补丁不完整）⇒ 截断定位闭嘴", async () => {
    await writeFile(join(dir, "src", "a.ts"), ["LINE-ONE-FRAME", "line2", "line3"].join("\n") + "\n", "utf8");
    const oneHunk = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+LINE2",
      " line3",
    ].join("\n");
    const msg = await runErr(oneHunk);
    expect(msg).toContain("上下文对不上");
    expect(msg).toContain('"LINE-ONE-FRAME"');
    expect(msg).not.toContain("截断定位");
    expect(msg).not.toContain("少抄");
    expect(msg).not.toContain("丢了前导标记");
    expect(await readFile(join(dir, "src", "a.ts"), "utf8")).toBe(["LINE-ONE-FRAME", "line2", "line3"].join("\n") + "\n");
  });

  it("反向守卫：成功回执里没有定位（正常应用那半条路径一个字都没变）", async () => {
    const okPatch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+LINE2",
      " line3",
    ].join("\n");
    const r = await apply_patch.run({ patch: okPatch }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("已应用补丁");
    expect(r.output).not.toContain("截断定位");
    expect(await readFile(join(dir, "src", "a.ts"), "utf8")).toBe(["line1", "LINE2", "line3"].join("\n") + "\n");
  });
});
