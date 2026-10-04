// apply_patch 的「非 LF 文件」与「非升序 hunk」两种形状（2026-10-02 普查增补）。
//
// 立项动因（实测）：`src/tools/apply_patch.ts` 已有 **28** 条判卷（原子性、路径四闸、
// 二义定位、快照次序、上限都有），覆盖面相当扎实。普查时按 §7.6 的顺序问的是
// 「哪些形状还没有证人」，查到两处**零覆盖**：
//
//   ① CRLF 文件（BOM 同族）：`contentLines` 只按 `\n` 切 ⇒ 每行都留着 `\r`，
//      而 `locate` 要求**逐字**相同（源码注释：「静默改到别处比改不动危险得多」）。
//   ② hunk 不按升序排列：`buildFile` 按补丁里的**出现顺序**推进 cursor，
//      于是靠后出现、位置靠前的 hunk 会被判成「与上一处重叠」。
//
// 两条实测结论都是**安全地拒绝**（不是静默改坏），所以本文件钉的是「这个拒绝是刻意的」，
// 而不是「这里有 bug」。为什么要钉：将来有人觉得「CRLF 匹配不上很难用」而去
// `strip \r`，那会把**整个文件的行尾**静默改写成 LF——比拒绝坏得多，而那时没有一条断言会红。
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply_patch, PATCH_LIMIT_BYTES } from "../src/tools/apply_patch";

/** 在**给定**工作区里跑补丁（工作区由 withFile 建好并写入了待测文件）。 */
async function runIn(ws: string, patch: string): Promise<{ ok: boolean; output: string }> {
  const r = await apply_patch.run({ patch }, { workspace: ws, cwd: ws } as never);
  return { ok: r.ok === true, output: String(r.output) };
}

/** 造一个含指定文件的工作区，跑一次回调，回调收到盘上绝对路径。 */
async function withFile<T>(
  name: string,
  content: string,
  fn: (ws: string, abs: string) => Promise<T>,
): Promise<T> {
  const ws = await mkdtemp(join(tmpdir(), "dsh-apf-"));
  try {
    const abs = join(ws, name);
    await writeFile(abs, content, "utf8");
    return await fn(ws, abs);
  } finally {
    await rm(ws, { recursive: true, force: true }).catch(() => {});
  }
}

describe("CRLF 文件：拒绝，且报错要说清差在 \\r", () => {
  const patch = [
    "diff --git a/f.txt b/f.txt",
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1,3 +1,4 @@",
    " line one",
    "+INSERTED",
    " line two",
    " line three",
    "",
  ].join("\n");

  it("上下文逐字不匹配 ⇒ 抛错，且**盘上一个字节都不改**", async () => {
    await withFile("f.txt", "line one\r\nline two\r\nline three\r\n", async (_ws, abs) => {
      const before = await readFile(abs);
      await expect(runIn(_ws, patch)).rejects.toThrow(); // fail-safe：抛错而不是「改到别处」
      const after = await readFile(abs);
      expect(after.equals(before), "拒绝时文件必须逐字节不变").toBe(true);
    });
  });

  it("报错正文要把 \\r 点出来（模型据此知道是行尾差异，不是内容不符）", async () => {
    await withFile("f.txt", "line one\r\nline two\r\nline three\r\n", async (_ws, abs) => {
      const err = await runIn(_ws, patch).then(() => null, (e: Error) => e);
      expect(err).not.toBeNull();
      // 期望值里没有 \r、实际值里有 ⇒ 这正是模型要的那条线索
      expect(err?.message).toContain('"line one\\r"');
    });
  });

  // 这条是**刻意不修**的证人：把 \r 归一化看起来能"修好"CRLF，
  // 但代价是把整个文件的行尾静默改写成 LF——比拒绝坏得多。
  it("刻意不做 \\r 归一化：CRLF 保持 CRLF（改这条前先读这里）", async () => {
    await withFile("f.txt", "line one\r\nline two\r\n", async (_ws, abs) => {
      await runIn(_ws, patch).catch(() => {});
      const raw = await readFile(abs, "utf8");
      expect(raw).toBe("line one\r\nline two\r\n"); // 行尾原样
    });
  });
});

describe("BOM 文件：同族，拒绝而不是把 BOM 吃掉", () => {
  it("首行带 BOM ⇒ 逐字不匹配 ⇒ 抛错，盘上不变", async () => {
    const patch = [
      "diff --git a/b.txt b/b.txt",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -1,2 +1,3 @@",
      " line one",
      "+NEW",
      " line two",
      "",
    ].join("\n");
    await withFile("b.txt", "﻿line one\nline two\n", async (_ws, abs) => {
      const before = await readFile(abs);
      await expect(runIn(_ws, patch)).rejects.toThrow();
      expect((await readFile(abs)).equals(before)).toBe(true);
    });
  });
});

describe("hunk 不按升序：拒绝（文案说的是「重叠」，实为顺序反了）", () => {
  it("靠后出现但位置靠前的 hunk ⇒ 被判重叠 ⇒ 抛错，盘上不变", async () => {
    // 先声明第 4 行那段、再声明第 1 行那段。内容各自都能对上，
    // 但 buildFile 按**出现顺序**推进 cursor，第二段的位置落在已用区间内 ⇒ 判重叠。
    const patch = [
      "diff --git a/o.txt b/o.txt",
      "--- a/o.txt",
      "+++ b/o.txt",
      "@@ -4,2 +4,3 @@",
      " d",
      "+INS_D",
      " e",
      "@@ -1,2 +1,3 @@",
      " a",
      "+INS_A",
      " b",
      "",
    ].join("\n");
    await withFile("o.txt", "a\nb\nc\nd\ne\n", async (_ws, abs) => {
      const before = await readFile(abs);
      const err = await runIn(_ws, patch).then(() => null, (e: Error) => e);
      expect(err).not.toBeNull();
      expect(err?.message).toContain("重叠");
      expect((await readFile(abs)).equals(before), "拒绝时必须逐字节不变").toBe(true);
    });
  });

  // ↑ 这条同时是一处**文案不准**的登记：两段并没有重叠，只是顺序反了。
  // 本轮不改文案（会动到既有判卷文案面），只把「现状 + 为何不改」钉在这里。
  it("升序时同一份补丁正常落地（对照组：确认拒的是顺序不是内容）", async () => {
    const patch = [
      "diff --git a/o.txt b/o.txt",
      "--- a/o.txt",
      "+++ b/o.txt",
      "@@ -1,2 +1,3 @@",
      " a",
      "+INS_A",
      " b",
      "@@ -4,2 +4,3 @@",
      " d",
      "+INS_D",
      " e",
      "",
    ].join("\n");
    const r = await withFile("o.txt", "a\nb\nc\nd\ne\n", (ws) => runIn(ws, patch));
    expect(r.ok).toBe(true);
  });
});

describe("入参上限", () => {
  it("补丁正文超上限即拒（入参无界 = 上下文面无界）", async () => {
    const huge = "x".repeat(PATCH_LIMIT_BYTES + 1);
    await withFile("f.txt", "a\n", (ws) => expect(runIn(ws, huge)).rejects.toThrow());
  });
});