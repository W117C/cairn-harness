// 诊断包判卷（2026-10-30 · 第 807 页）：报告 + 日志尾部拼成一份可带走的 Markdown。
// 关键口径：日志文件不在 = 明确写「没有」，不静默省略；截断必须标注；读尾按行数收口。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDiagnosticsBundle, readLogTail } from "../src/main/diagnostics-bundle";

const dirs: string[] = [];
function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-diag-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("诊断包拼接", () => {
  it("标题 / 生成时间 / 报告 / 日志围栏都在", () => {
    const bundle = buildDiagnosticsBundle({
      reportText: "Cairn 诊断报告\n总档：就绪（9 项全过）",
      generatedAt: "2026-10-30T05:00:00.000Z",
      logTail: { text: "[info] boot", truncated: false, lines: 1 },
    });
    expect(bundle).toContain("# Cairn 诊断包");
    expect(bundle).toContain("生成时间：2026-10-30T05:00:00.000Z");
    expect(bundle).toContain("## 诊断报告");
    expect(bundle).toContain("总档：就绪（9 项全过）");
    expect(bundle).toContain("```text\n[info] boot\n```");
  });

  it("没有日志文件：明确写出来，不静默省略", () => {
    const bundle = buildDiagnosticsBundle({ reportText: "R", generatedAt: "T", logTail: null });
    expect(bundle).toContain("（没有日志文件");
    expect(bundle).not.toContain("```text");
  });

  it("日志被截断时在标题行标注，不冒充完整", () => {
    const bundle = buildDiagnosticsBundle({
      reportText: "R",
      generatedAt: "T",
      logTail: { text: "last", truncated: true, lines: 1 },
    });
    expect(bundle).toContain("更早内容已截断");
  });
});

describe("readLogTail", () => {
  it("只留末尾 N 行，并报 truncated；行数按实际保留数", async () => {
    const file = tempFile("main.log", Array.from({ length: 30 }, (_, i) => `line-${String(i)}`).join("\n") + "\n");
    const tail = await readLogTail(file, { maxLines: 5, maxBytes: 1024 * 1024 });
    expect(tail?.lines).toBe(5);
    expect(tail?.text).toContain("line-29");
    expect(tail?.text).not.toContain("line-24");
    expect(tail?.truncated).toBe(true);
  });

  it("小文件不标截断；文件不存在返回 null", async () => {
    const file = tempFile("main.log", "a\nb\n");
    const tail = await readLogTail(file, { maxLines: 5 });
    expect(tail).toEqual({ text: "a\nb", truncated: false, lines: 2 });
    expect(await readLogTail(join(tmpdir(), "cairn-no-such-log-xyz.log"))).toBeNull();
  });
});
