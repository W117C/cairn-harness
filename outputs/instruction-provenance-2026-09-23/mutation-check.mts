/** 能力 19 L0 的分辨力实测（页面 §四 C4 的两针 + 第三针「整段摘掉」）。
 *
 *  为什么单独写一份、不复用 `scripts/mutate-verify.mjs`：那张表里 `src/agent/context.ts`
 *  这一格还没登记，而登记要改的那个文件正带着**别人**的未提交改动（判卷面在飞时整表会拒绝变在飞文件）。
 *  本脚本做同一件事的最小版：备份 → 突变 → 跑那一份测试 → 记录红的是哪几条 → **逐字还原**，
 *  最后一道 `finally` 之外再核一次字节相同（不一样就红着退出，绝不把突变留在工作树里）。
 *
 *  跑法：TERM=dumb node --import tsx outputs/instruction-provenance-2026-09-23/mutation-check.mts
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CTX = join(ROOT, "src/agent/context.ts");
const READ = join(ROOT, "src/tools/read_file.ts");
const TEST = "tests/instruction-provenance.test.ts";

const MUTS: { id: string; what: string; edits: { file: string; from: string; to: string }[]; mustKill: string[] }[] = [
  {
    id: "M1-drop",
    what: "整段摘掉投影出口的中和（回到 09-23 的缺陷现场）",
    edits: [{ file: CTX, from: "content: escapeControlTags(pruned ?? e.output)", to: "content: pruned ?? e.output" }],
    mustKill: ["真 read_file + 真 projectContext", "入口① 工具输出", "入口② prune 的替换文本"],
  },
  {
    id: "M2-into-tool",
    what: "针 A：把 L0 **整体**从投影出口挪进 read_file 工具（本仓点名的「补在工具里 = 再造五份出口副本」）。" +
      "⚠️ 第一版只搬了工具输出那一处 ⇒ ③④ 活着是**我的期望写错**（形似突变，没复现失效方式），不是判据失效。",
    edits: [
      { file: CTX, from: "content: escapeControlTags(pruned ?? e.output)", to: "content: pruned ?? e.output" },
      { file: CTX, from: "    escapeControlTags(summary)", to: "    summary" },
      { file: CTX, from: "  return escapeControlTags(\n    head +", to: "  return (\n    head +" },
      { file: CTX, from: '  return escapeControlTags(e.outcome === "output_budget"', to: '  return e.outcome === "output_budget"' },
      { file: CTX, from: '别把半句当结论交出去。");', to: '别把半句当结论交出去。";' },
      { file: CTX, from: "  return escapeControlTags(\n    `[harness] 工具调用", to: "  return (\n    `[harness] 工具调用" },
      { file: READ, from: 'import { basename, dirname, join } from "node:path";',
        to: 'import { basename, dirname, join } from "node:path";\nimport { escapeControlTags } from "../agent/control-tags.js";' },
      { file: READ, from: "return { ok: true, output: out };", to: "return { ok: true, output: escapeControlTags(out) };" },
    ],
    mustKill: ["入口① 工具输出", "入口② prune 的替换文本", "入口③ 压缩摘要信封", "入口④ 自动验证拍", "入口⑤ 悬空调用补位"],
  },
  {
    id: "M3-writeback",
    what: "针 B：让中和写回事件流（篡改历史 + 打断缓存 + 判卷看不见原始字节）",
    edits: [{ file: CTX, from: "const pruned = replacements?.get(id);",
      to: "const pruned = replacements?.get(id);\n      e.output = escapeControlTags(e.output); // 突变：写回事件流" }],
    mustKill: ["事件流里的原文逐字节不变"],
  },
  {
    id: "M4-per-site",
    what: "逐处摘：只摘摘要信封那一处（证明入口③ 真的看着自己那一格，不是被 M1 顺带杀掉的）",
    edits: [{ file: CTX, from: "    escapeControlTags(summary)", to: "    summary" }],
    mustKill: ["入口③ 压缩摘要信封"],
  },
  {
    id: "M5-per-site",
    what: "逐处摘：只摘自动验证拍那一处",
    edits: [{ file: CTX, from: "  return escapeControlTags(\n    head +", to: "  return (\n    head +" }],
    mustKill: ["入口④ 自动验证拍"],
  },
  {
    id: "M6-per-site",
    what: "逐处摘：只摘悬空调用补位那一处",
    edits: [{ file: CTX, from: "  return escapeControlTags(\n    `[harness] 工具调用", to: "  return (\n    `[harness] 工具调用" }],
    mustKill: ["入口⑤ 悬空调用补位"],
  },
];

function runTests(): { exit: number; failed: string[]; raw: string } {
  try {
    const out = execFileSync(
      process.execPath,
      ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", TEST],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "dumb" } },
    );
    return { exit: 0, failed: [], raw: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const text = (err.stdout ?? "") + (err.stderr ?? "");
    const failed = [...text.matchAll(/^ FAIL\s+\S+\s+>\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim());
    return { exit: err.status ?? 1, failed, raw: text };
  }
}

const backup = mkdtempSync(join(tmpdir(), "prov-mut-bak-"));
const files = [CTX, READ];
const orig = new Map<string, string>();
let code = 0;
try {
  for (const f of files) {
    orig.set(f, readFileSync(f, "utf8"));
    copyFileSync(f, join(backup, f.slice(ROOT.length + 1).replace(/\//g, "_")));
  }
  for (const m of MUTS) {
    for (const ed of m.edits) {
      const b = readFileSync(ed.file, "utf8");
      if (!b.includes(ed.from)) throw new Error(`${m.id}: 靶文本没找到 → ${ed.from.slice(0, 40)}`);
      writeFileSync(ed.file, b.replace(ed.from, ed.to), "utf8");
    }
    const r = runTests();
    console.log(`\n## ${m.id} ${m.what}`);
    console.log(`   跑测试 exit=${String(r.exit)}  红 ${String(r.failed.length)} 条`);
    if (r.exit !== 0 && r.failed.length === 0) {
      const why = (r.raw.split("\n").filter((l) => /Error|error TS|Expected|Unexpected/.test(l))[0] ?? "(没抓到错因行)").slice(0, 160);
      console.log(`   ⚠️ 退出码非零但一条 FAIL 都没有 = 收集期崩了（多半是突变写坏语法），这条读数不可信：${why}`);
    }
    let miss = 0;
    for (const k of m.mustKill) {
      const hit = r.failed.some((t) => t.includes(k));
      if (!hit) miss++;
      console.log(`   ${hit ? "杀掉 " : "存活!"} ${k}`);
    }
    for (const f of r.failed) if (!m.mustKill.some((k) => f.includes(k))) console.log(`   （附带红：${f}）`);
    if (r.exit === 0) { console.log("   ⚠️ 全绿 ⇒ 这条突变没被任何判据抓到 = 恒真式等价物"); miss = m.mustKill.length; }
    if (miss > 0) code = 1;
    for (const [f, text] of orig) writeFileSync(f, text, "utf8");
  }
} finally {
  let dirty = 0;
  for (const [f, text] of orig) {
    if (readFileSync(f, "utf8") !== text) { console.log(`❌ 还原失败：${f} 与备份不同 —— 立刻 git diff 检查！`); dirty++; }
  }
  rmSync(backup, { recursive: true, force: true });
  console.log(dirty === 0 ? "\n还原核对：两个源文件逐字相同。" : `\n还原核对：${String(dirty)} 个文件未还原。`);
  if (dirty > 0) code = 1;
}
console.log(code === 0 ? "⇒ 三针全部被抓到：判据对这三种失效方式有分辨力。" : "⇒ 有突变存活，见上面「存活!」。");
process.exit(code);
