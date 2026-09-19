// 「文件超 4KB 只回注大纲，正文按需 read」（agent-plan §8.1.5 / §6.5）此前只按**字节**判门槛，
// 大纲帽却按**字符**给（shapeDoc(raw, 4096)）⇒ 任何 4KB–16KB 的中文 ARCHITECTURE.md
// （字节超门槛、字符数 ≤ 4096）走的是 shapeDoc 第一行 `output.length <= maxChars ⇒ 逐字返回`：
// 整份原文注进去，块首还写着「原文 N 字节 > 4KB，按需 read_file」——那句对模型是假话，
// 而「只注大纲」正是这条预算的第一道省法。实测：5030 字节 / 1910 字符 → 注入 2114 字符、无 [大纲] 标记。
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemoryInjection } from "../src/agent/memory/inject";

function wsOf(arch: string): string {
  const ws = mkdtempSync(join(tmpdir(), "mem-arch-"));
  mkdirSync(join(ws, ".agent", "memory"), { recursive: true });
  writeFileSync(join(ws, ".agent", "ARCHITECTURE.md"), arch, "utf8");
  const empty = join(ws, "global");
  mkdirSync(empty, { recursive: true });
  return ws;
}

describe("ARCHITECTURE 大纲帽按同一把尺，且必然小于原文", () => {
  it("中文文档（>4KB 字节、字符数 <4096）注的确实是大纲，不是整份原文", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) lines.push("## 模块" + String(i) + "：分层与约定", "- 本模块负责把外界的中文文本收进预算，判定与取点共用一份字重表。");
    const raw = lines.join("\n") + "\n";
    expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(4096);
    expect(raw.length).toBeLessThan(4096);
    const ws = wsOf(raw);
    const r = await buildMemoryInjection({ workspace: ws, globalRoot: join(ws, "global"), tokenBudget: 6000 });
    expect(r.project).toContain("[大纲]");
    expect((r.project ?? "").length).toBeLessThan(raw.length); // 「只注大纲」必须真的更小
  });

  it("小文档（≤4KB 字节）逐字注入、不套大纲头（零回归）", async () => {
    const raw = "# 架构\n只有一小段中文。\n";
    const ws = wsOf(raw);
    const r = await buildMemoryInjection({ workspace: ws, globalRoot: join(ws, "global"), tokenBudget: 6000 });
    expect(r.project).toContain("# 架构");
    expect(r.project).not.toContain("按需 read_file");
  });

  it("英文大文档仍按 4096 字符帽（不变小、不变大）", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 600; i++) lines.push("## Section " + String(i), "body " + "x".repeat(60));
    const raw = lines.join("\n") + "\n";
    const ws = wsOf(raw);
    const r = await buildMemoryInjection({ workspace: ws, globalRoot: join(ws, "global"), tokenBudget: 6000 });
    expect(r.project).toContain("[大纲]");
    expect((r.project ?? "").length).toBeLessThanOrEqual(4096 + 250); // 250 = 截断标记（与同族 +40 同口径，落在帽外）+ 块首声明/大纲头/元数据行
  });
});
