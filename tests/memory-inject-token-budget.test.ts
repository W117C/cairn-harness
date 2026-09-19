// 记忆注入的总预算**以 token 计**（agent-plan §8.1.5「总记忆注入预算默认 6K token」）。
// 旧实现把 6K token 折成 24000 字符后只比字符数 ⇒ 中文段一字≈一 token，实测 38% CJK
// 语料塞到 chars_current=23990 时自报 5998 token、按字重已是 14021 token（超 2.3 倍），
// 而这块要进系统文本区、每轮重送、且永不进压缩归档 ⇒ 一次性低估变成整会话付费。
// 判据一律用 text-budget 的估算器**独立复核渲染后的整块**，不读实现的自报数。
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemoryInjection } from "../src/agent/memory/inject";
import { estimateTextTokens } from "../src/agent/text-budget";

// 每条 ≈60 字符 / 中文部分 ≈56 token（字重 1 字一 token）
const cjkLine = (n: number): string => "记忆条目" + String(n) + "：" + "中文内容".repeat(12);
// 每条 133 字符（纯 ASCII：4 字符一 token）
const asciiLine = (n: number): string => "entry " + String(n) + ": " + "abcdefghij".repeat(12);

async function fixture(lines: string[]): Promise<{ workspace: string; globalRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "mem-budget-"));
  const dir = join(root, ".agent", "memory");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "MEMORY.md"), lines.join("\n") + "\n", "utf8");
  const globalRoot = join(root, "global");
  await mkdir(globalRoot, { recursive: true });
  return { workspace: root, globalRoot };
}

describe("记忆注入预算以 token 计量（能力 9 成本面）", () => {
  it("中文语料超预算：整块按字重收进声明预算内，且如实报 truncated", async () => {
    const { workspace, globalRoot } = await fixture(Array.from({ length: 400 }, (_, i) => cjkLine(i)));
    const r = await buildMemoryInjection({ workspace, globalRoot, tokenBudget: 600 });
    const block = (r.project ?? "") + (r.global ?? "");
    expect(r.truncated).toBe(true);
    // 块级独立复核：不越过声明预算（+100 = 块首声明与元数据行的固定开销）
    expect(estimateTextTokens(block)).toBeLessThanOrEqual(600 + 100);
    // 也不许多丢：删行游标若与实际字重脱钩，会一路删到预算的几分之一
    expect(estimateTextTokens(block)).toBeGreaterThanOrEqual(600 - 120);
    // 旧的字符口径在这条预算下会留到 charsLimit=2400；按字重收口只该用到六七百字符
    expect(r.charsCurrent).toBeLessThan(1200);
  });

  it("混合语料同样收进 token 帽（只看字符会放过两倍超支）", async () => {
    const mixed = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? cjkLine(i) : asciiLine(i)));
    const { workspace, globalRoot } = await fixture(mixed);
    const r = await buildMemoryInjection({ workspace, globalRoot, tokenBudget: 500 });
    expect(estimateTextTokens((r.project ?? "") + (r.global ?? ""))).toBeLessThanOrEqual(500 + 100);
  });

  it("预算内逐字全留（零回归：不提示、不丢行）", async () => {
    const { workspace, globalRoot } = await fixture([cjkLine(1), asciiLine(2)]);
    const r = await buildMemoryInjection({ workspace, globalRoot, tokenBudget: 6000 });
    expect(r.truncated).toBe(false);
    expect(r.project).toContain("记忆条目1");
    expect(r.project).toContain("entry 2");
    expect(r.project).not.toContain("整行丢弃");
  });

  it("纯 ASCII 会话：换口径不收紧（字符帽仍是那条线，两套读数同值）", async () => {
    const { workspace, globalRoot } = await fixture(Array.from({ length: 20 }, (_, i) => asciiLine(i)));
    const r = await buildMemoryInjection({ workspace, globalRoot, tokenBudget: 250 });
    expect(r.charsLimit).toBe(1000);
    expect(r.charsCurrent).toBeLessThanOrEqual(1000);
    expect(r.charsCurrent).toBeGreaterThan(1000 - 140); // 一条整行的余量内：没有多丢
    expect(Math.abs(r.tokens - r.charsCurrent / 4)).toBeLessThanOrEqual(3);
  });

  it("元数据行两套口径都报，tokens_limit 就是声明的预算（不拿字符帽冒充预算）", async () => {
    const { workspace, globalRoot } = await fixture(Array.from({ length: 200 }, (_, i) => cjkLine(i)));
    const r = await buildMemoryInjection({ workspace, globalRoot, tokenBudget: 700 });
    expect(r.project).toContain("tokens_limit=700");
    expect(r.project).toContain("chars_limit=" + String(r.charsLimit));
    expect(r.tokens).toBeLessThanOrEqual(700);
    // 自报数必须是字重口径：中文块按 chars/4 报会把真实量低估 4 倍（回到旧口径的暗号）
    expect(r.tokens).toBeGreaterThan(Math.ceil(r.charsCurrent / 4));
  });
});
