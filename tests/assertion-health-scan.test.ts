// 判卷面自己也得被验：断言体检（空断言 / 恒真式 / 暗卷段零断言 / 析取式弱断言）此前只在 `pnpm gates`
// 里跑 —— 一条恒真的 `check(true, …)` 要等整套门禁（十几分钟）才被抓到，而 `pnpm test` 里
// 一条测都没引用过这个扫描器（"抽出以便单测"的注释写了，单测没来）。本文件把它接进快路。
//
// 扫描面 = **git 已跟踪**的 scripts：未跟踪的在飞草稿（别人的 scratch probe）按本仓既有口径
// 属"在飞改动、不属 HEAD 回归"，与 scripts/typecheck.ts 的归因同一套 —— 判卷不许因为
// 隔壁会话正在写一个探针就红。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanAssertionHealth, scanDisjunctions } from "../scripts/assertion-health";
import { scriptFilesFromLsFiles, trackedScriptFiles } from "../scripts/lib/scan-scope";

const ROOT = process.cwd();

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
    const files = trackedScriptFiles(ROOT) ?? [];
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

  // 扫描面是"哪些文件算判卷"这件事的**唯一实现**（gates.ts 与这里共用 ./lib/scan-scope.ts）。
  // 曾经各抄一份：快路只判已跟踪、gates 走磁盘遍历 ⇒ 隔壁会话一个未跟踪探针就能把整张门表判红。
  it("扫描面只收 git 已跟踪的脚本，未跟踪草稿不进判卷面", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-scan-scope-"));
    try {
      const git = (args: string[]): void => { execFileSync("git", args, { cwd: dir, stdio: "ignore" }); };
      git(["init", "-q"]);
      mkdirSyncScripts(dir);
      writeFileSync(join(dir, "scripts", "tracked-a.ts"), 'check("x", true);\n');
      writeFileSync(join(dir, "scripts", "draft-b.ts"), 'check("y", true);\n');
      writeFileSync(join(dir, "scripts", "notes.md"), "check 示例不算脚本\n");
      git(["add", "scripts/tracked-a.ts"]); // draft-b.ts 故意留在未跟踪
      const files = trackedScriptFiles(dir);
      expect(files, "有已跟踪脚本时不许退回磁盘遍历").not.toBeNull();
      expect(files).toEqual(["scripts/tracked-a.ts"]); // 未跟踪草稿与 .md 都不在
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // 成对的另一半：清单取不到 / 空到可疑时必须交 null 给调用方退回磁盘遍历，
  // 不许把"没拿到清单"当成"没有要扫的东西"（那是 fail-open）。
  it("已跟踪清单为空 ⇒ 返回 null（调用方退回磁盘遍历，不静默少判）", () => {
    expect(scriptFilesFromLsFiles("scripts/a.ts\nscripts/notes.md\n\n")).toEqual(["scripts/a.ts"]);
    const dir = mkdtempSync(join(tmpdir(), "dsh-scan-empty-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
      mkdirSyncScripts(dir);
      writeFileSync(join(dir, "scripts", "only-draft.ts"), "export const a = 1;\n");
      expect(trackedScriptFiles(dir), "仓库里一个脚本都没跟踪 ⇒ null").toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(trackedScriptFiles(join(tmpdir())), "不是 git 仓库 ⇒ null").toBeNull();
  });
});

function mkdirSyncScripts(dir: string): void {
  execFileSync("mkdir", ["-p", join(dir, "scripts")], { stdio: "ignore" });
}

describe("空断言 / 恒真式判据的边界（AST 化以后两头都不许失准）", () => {
  const kindsOf = (src: string): string[] => scanAssertionHealth("t.ts", src).map((h) => h.kind);

  // 本仓至少三套断言签名。三参等值签名里的 `true` 是**期望值**，是一条真断言。
  it("三参等值签名 check(name, actual, true) ⇒ 不报（旧正则把这一族整批判成空断言）", () => {
    expect(kindsOf('check("折叠项目组后行数减少", collapsed < 8, true);\n')).toEqual([]);
  });

  it("label-first 两参 check(label, true) ⇒ 报（收窄判定面后必须留着的那一半）", () => {
    expect(kindsOf('check("x", true);\n')).toContain("empty-assert");
  });

  it("cond-first check(true, label) 与裸 assert(true) ⇒ 报", () => {
    expect(kindsOf('check(true, "永远绿");\n')).toContain("empty-assert");
    expect(kindsOf("assert(true);\n")).toContain("empty-assert");
  });

  // 本轮自踩的那一次：判据自己的文档注释里举了个反例，旧写法（按行正则 + 只 strip 行注释）
  // 把续行 ` * …` 当代码，实测在本文件里自命中 3 条 ⇒ "写一句解释"变成"把门表判红"。
  it("注释里的示例不算代码（空断言与恒真式两边都不报）", () => {
    const src = [
      "/**",
      ' * 反例写法：check("x", true) 与 if (a || true) 都**不**该被这里判成命中。',
      " */",
      "export const ok = 1;",
      "",
    ].join("\n");
    expect(scanAssertionHealth("doc.ts", src)).toEqual([]);
    // 行注释同一判据
    expect(scanAssertionHealth("doc2.ts", '// 例：check("x", true) / a || true\nexport const ok = 1;\n')).toEqual([]);
  });

  it("代码里的恒真式仍报：右支字面 true 与新加的左支字面 true", () => {
    expect(kindsOf("if (a || true) f();\n")).toContain("tautology");
    expect(kindsOf("if (true || a) f();\n")).toContain("tautology");
  });
});
