// G6 那只判据的单源面（scripts/lib/source-literals.ts）——2026-10-04 第 372 页。
//
// 这页存在的理由是一次**尺坏**：门扫整份源码文本，被 `who(e.agent_id)` 的巧合子串 ".agent" 撞红，
// 而压缩器一行都没碰记忆目录；判卷当天已收紧成「只看字符串字面量」，门侧漏了同步，于是门红判卷绿。
//
// 分工（照本仓惯例）：
//   · 纯函数层（本页上半）——判**判据本身的边界**：什么该抓到、什么绝不该被抓、会不会退化成恒绿。
//   · 接线层（本页下半）——判门真的用上了这只谓词，且旧那条过宽写法已经不在门里（否则会漂回去）。
//
// 「只扫字面量」的覆盖面：会抓字符串字面量（真要读记忆目录必须写 `".agent"`，真要 import fs
// 必须写 `"node:fs..."`）；不会抓注释、变量名、属性名（如 `e.agent_id`）——那一档是有意缩窄，
// 因为它们不是代码路径。「真读了没有」的正证是 memory-check 的 G5（canary 逐字未变），不是这条静态代理。
import { it, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memorySurfaceHits, stringLiterals } from "../scripts/lib/source-literals";

describe("字面量抽取：三类引号 + 转义 + 不许提前闭引号", () => {
  it("双引号 / 单引号 / 反引号都抽得到", () => {
    expect(stringLiterals(`const a = "x"; const b = 'y'; const c = \`z\`;`)).toEqual(["x", "y", "z"]);
  });

  it("转义引号不会把一个字面量劈成两个", () => {
    // "a\"b" 是一个字面量；若不认 \\. 转义，会被切成 "a\" 与 "b" 两段。
    expect(stringLiterals(String.raw`const s = "a\"b";`)).toEqual([String.raw`a\"b`]);
  });

  it("空字面量也抽得到（不许因为空就跳过）", () => {
    expect(stringLiterals(`f("", '')`)).toEqual(["", ""]);
  });
});

describe("记忆面危险引用：只扫字面量面", () => {
  it("字面量里的 .agent 必须抓到", () => {
    expect(memorySurfaceHits(`const p = join(ws, ".agent", "memory");`)).toContain(".agent");
  });

  it("属性访问 e.agent_id 不是字面量 ⇒ 绝不误伤（这次红的就是它）", () => {
    // 合成用例：与真实回归同形——一次与记忆目录无关的属性访问，源码里没有 ".agent" 字面量。
    expect(memorySurfaceHits(`push(label + who(e.agent_id), reasonOf(c));`)).toEqual([]);
  });

  it("注释里提到 .agent 不算命中（有意缩窄的一档：注释不是代码路径）", () => {
    // 这一条是我自己写完判据后当场踩出来的：初稿在注释里写「覆盖面没缩」，实测 `//` 行注释
    // 根本不是字符串字面量、抽不出来 ⇒ 那句话过头了，这里按实测改口。
    // 缩窄是否可接受，理由是：注释里提一句 ".agent" 不会让压缩器去读记忆目录；
    // 而「真读了没有」的正证不是这条静态代理，是 memory-check 的 G5（canary 逐字未变）。
    expect(memorySurfaceHits(`// 这里读的是 .agent/memory/MEMORY.md\nconst x = 1;`)).toEqual([]);
    expect(memorySurfaceHits(`/* .agent MEMORY.md */\nconst x = 1;`)).toEqual([]);
  });

  it("node:fs 与 fs/promises 两个形态都抓得到", () => {
    expect(memorySurfaceHits(`const fs = await import("node:fs");`)).toContain("node:fs");
    expect(memorySurfaceHits(`const fs = await import("fs/promises");`)).toContain("fs/promises");
  });

  it("多个命中按固定次序全报出来（不早退，门上要能点名是哪几类）", () => {
    const hits = memorySurfaceHits(`const a = "node:fs"; const b = ".agent"; const c = "MEMORY.md";`);
    expect(hits).toEqual(["node:fs", ".agent", "MEMORY.md"]);
  });

  it("node:fs 恰好是最后一个字面量也抓得到（末尾补换行那条硬化）", () => {
    // 不补那个换行的话：`(^|[^\w])` 无后继字符可比，而 `^` 未开 m 只认整串开头 ⇒ 漏。
    expect(memorySurfaceHits(`import "node:fs";`)).toContain("node:fs");
    expect(memorySurfaceHits(`const f = "node:fs"`)).toContain("node:fs");
  });

  it("干净源码零命中（正向对照）", () => {
    expect(memorySurfaceHits(`export const cap = 2800; export function pick(xs: number[]) { return xs[0]; }`)).toEqual([]);
  });
});

describe("真仓面：压缩器本身", () => {
  const src = readFileSync(join(process.cwd(), "src", "agent", "compaction.ts"), "utf8");

  it("零命中（这就是 G6 要的那一格）", () => {
    expect(memorySurfaceHits(src)).toEqual([]);
  });

  it("字面量抽取非空（反向自证：尺没退化成「永远不匹配」）", () => {
    expect(stringLiterals(src).length).toBeGreaterThan(5);
  });
});

describe("接线面：门侧真的换成了这只谓词", () => {
  const gate = readFileSync(join(process.cwd(), "scripts", "memory-check.ts"), "utf8");

  it("门引用了单源模块（不许哪天漂回自己写一份）", () => {
    expect(gate).toContain("memorySurfaceHits");
    expect(gate).toContain('from "./lib/source-literals"');
  });

  it("旧那条过宽写法已经从门里消失（includes(\".agent\") 扫整份文本）", () => {
    // 反向守卫：把这行塞回去，G6 就会重新被巧合子串撞红——判卷必须当场抓住。
    expect(gate).not.toMatch(/compactionSrc\.includes\(/);
    expect(gate).not.toMatch(/src\.includes\("\.agent"\)/);
  });
});