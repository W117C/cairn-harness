// 超预算时提示必须说清「整段省略了哪几段」：实测一份成熟记忆集（索引顶到 200 行硬上限 +
// ARCHITECTURE 大纲 + 20 条 DECISIONS）在**缺省 6000 token** 下会连 ARCHITECTURE 与 DECISIONS
// 整段抽干、只留索引——模型看到 5966 token 的目录却不知道该去读被没掉的正文。
// 只补一句点名（含取回通道），不改丢弃顺序（那属产品优先级，待裁决）。
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemoryInjection } from "../src/agent/memory/inject";

function wsOf(files: Record<string, string>): string {
  const ws = mkdtempSync(join(tmpdir(), "mem-evict-"));
  mkdirSync(join(ws, ".agent", "memory"), { recursive: true });
  const globalRoot = join(ws, "global");
  mkdirSync(globalRoot, { recursive: true });
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(ws, rel), text, "utf8");
  return ws;
}
const zhLine = (i: number): string => "- [主题" + String(i) + "的中文标题](memory/topic-" + String(i) + ".md) — 一句话说明这条记忆讲什么，够长以贴近真实索引行。";

describe("整段省略要点名（能力 8：可解释 + 给取回通道）", () => {
  it("成熟记忆集在缺省预算下抽干了 ARCHITECTURE 与 DECISIONS ⇒ 提示点名这两段并给 read_file 通道", async () => {
    let idx = ""; for (let i = 0; i < 200; i++) idx += zhLine(i) + "\n";
    let arch = "# 架构\n"; for (let i = 0; i < 120; i++) arch += "## 模块" + String(i) + "\n" + "这一层的职责是收敛外界文本并如实提示截断。\n";
    let dec = ""; for (let i = 0; i < 20; i++) dec += "## 2026-09-0" + String(i % 9) + "\n决策" + String(i) + "：判定与取点共用一份字重表，避免估算与执行两套口径。\n";
    const ws = wsOf({
      ".agent/ARCHITECTURE.md": arch,
      ".agent/DECISIONS.md": dec,
      ".agent/memory/MEMORY.md": idx,
    });
    const r = await buildMemoryInjection({ workspace: ws, globalRoot: join(ws, "global"), tokenBudget: 6000 });
    const p = r.project ?? "";
    expect(r.truncated).toBe(true);
    expect(p).toContain("[MEMORY.md 索引]");           // 索引确实留下了（顺序未变）
    expect(p).toContain("已整段省略：");
    expect(p).toContain("ARCHITECTURE");
    expect(p).toContain("DECISIONS");
    expect(p).toContain("read_file");                  // 取回通道跟着点名一起给出
  });

  it("只削段内前部、没有任何段被抽干 ⇒ 提示行逐字保持旧文案（零回归）", async () => {
    let arch = "# 架构\n";
    for (let i = 0; i < 300; i++) arch += "## 模块" + String(i) + "\n" + "述".repeat(80) + "\n";
    const ws = wsOf({ ".agent/ARCHITECTURE.md": arch });
    const r = await buildMemoryInjection({ workspace: ws, globalRoot: join(ws, "global"), tokenBudget: 900 });
    const p = r.project ?? "";
    expect(r.truncated).toBe(true);
    expect(p).toContain("[truncated: 记忆注入超预算，已整行丢弃前部内容（保尾部）]");
    expect(p).not.toContain("已整段省略");
  });

  it("预算宽裕不截断时不打任何提示（零回归）", async () => {
    const ws = wsOf({ ".agent/ARCHITECTURE.md": "# 架构\n很短。\n" });
    const r = await buildMemoryInjection({ workspace: ws, globalRoot: join(ws, "global"), tokenBudget: 6000 });
    expect(r.truncated).toBe(false);
    expect(r.project).not.toContain("truncated");
  });
});
