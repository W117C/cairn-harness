// 判卷面自己也得被验：断言体检（空断言 / 恒真式 / 暗卷段零断言 / 析取式弱断言）此前只在 `pnpm gates`
// 里跑 —— 一条恒真的 `check(true, …)` 要等整套门禁（十几分钟）才被抓到，而 `pnpm test` 里
// 一条测都没引用过这个扫描器（"抽出以便单测"的注释写了，单测没来）。本文件把它接进快路。
//
// 扫描面 = **git 已跟踪**的 scripts：未跟踪的在飞草稿（别人的 scratch probe）按本仓既有口径
// 属"在飞改动、不属 HEAD 回归"，与 scripts/typecheck.ts 的归因同一套 —— 判卷不许因为
// 隔壁会话正在写一个探针就红。
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanAssertionHealth, scanDisjunctions } from "../scripts/assertion-health";

const ROOT = process.cwd();
const SCAN_EXT = /\.(?:ts|tsx|mjs|cjs|js)$/;

function trackedScripts(): string[] {
  const out = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter((l) => l !== "" && SCAN_EXT.test(l));
}

async function hitsOf(files: string[]): Promise<string[]> {
  const perFile = await Promise.all(files.map(async (rel) => {
    const src = await readFile(join(ROOT, rel), "utf8");
    return [...scanAssertionHealth(rel, src), ...scanDisjunctions(rel, src)]
      .map((h) => h.kind + " " + h.file + ":" + String(h.line) + " → " + h.text);
  }));
  return perFile.flat();
}

describe("判卷面断言体检（快路，与 pnpm gates 同一把尺）", () => {
  it("已跟踪的 scripts/ 里没有空断言、恒真式、暗卷段零断言、未豁免的析取式", async () => {
    const files = trackedScripts();
    expect(files.length, "扫描面本身不能是空的（扫不到文件 = 判据真空通过）").toBeGreaterThan(10);
    expect(await hitsOf(files)).toEqual([]);
  });

  // 上一条的判据是"零命中"，零命中既可能是"干净"也可能是"尺子断了" ⇒ 反向钉一次：
  // 同一把尺放进一段已知有病的源码里，必须报出那两条。
  it("尺子本身不是恒绿的：已知病样必须报出来", () => {
    const sick = [
      'check(true, "永远绿");',
      'if (a || true) console.log("恒真");',
      'assert(ok, "析取式", a || b);',
    ].join("\n");
    const kinds = [...scanAssertionHealth("probe.ts", sick), ...scanDisjunctions("probe.ts", sick)].map((h) => h.kind);
    expect(kinds).toContain("empty-assert");
    expect(kinds).toContain("tautology");
  });
});
