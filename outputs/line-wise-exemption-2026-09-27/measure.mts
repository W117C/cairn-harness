// 现读：`--check-needles` 归进"逐行式（不核针脚）"的到底是哪 11 条，以及几条候选判据各能分开谁。
// 用法：node --import tsx "outputs/line-wise-exemption-2026-09-27/measure.mts"
import { readFileSync } from "node:fs";
import { isLineWiseApply } from "../../scripts/lib/mutate-gates.ts";

const src = readFileSync("scripts/mutate-verify.mjs", "utf8");
// 取每条锚点的 id + apply 源码文字（表里 apply 都是单行或跨 2-4 行的箭头函数）
const rows: { id: string; text: string }[] = [];
const lines = src.split("\n");
for (let i = 0; i < lines.length; i++) {
  const m = /^    id: "([\w-]+)",$/.exec(lines[i]);
  if (!m) continue;
  const chunk = lines.slice(i, i + 14).join("\n");
  const a = /^    apply: (.*(?:\n\s+.*){0,4})$/m.exec(chunk);
  if (a) rows.push({ id: m[1], text: a[1] });
}
const wise = rows.filter((r) => isLineWiseApply(r.text));
console.log(`表里取到 ${rows.length} 条带 apply 的锚点，现行判据把它们分成：逐行式 ${wise.length} 条`);

// 候选判据
const CAND = {
  // 箭头之后（可跳过一个左花括号与少量声明）紧接着就是「某标识符.split(」
  firstOp: /=>\s*(?:\{\s*(?:const|let)\s+\w+\s*=\s*)?(\w+)\.split\(/,
  // 更强：按**换行**切输入
  firstOpOnNewline: /=>\s*(?:\{\s*(?:const|let)\s+\w+\s*=\s*)?\w+\.split\(\s*["']\\\\n["']/,
};
for (const [name, re] of Object.entries(CAND)) {
  const hit = wise.filter((r) => re.test(r.text)).map((r) => r.id);
  const extra = rows.filter((r) => !isLineWiseApply(r.text) && re.test(r.text)).map((r) => r.id);
  console.log(`\n候选 ${name}：在现行 11 条里命中 ${hit.length} 条 ⇒ 新暴露待检 ${wise.length - hit.length} 条；另在"非逐行式"里多抓 ${extra.length} 条 ${JSON.stringify(extra)}`);
}
console.log("\n现行判据认成逐行式的 11 条（★=候选 firstOpOnNewline 不认 ⇒ 收紧后新进入针脚体检）");
for (const r of wise) {
  const keep = CAND.firstOpOnNewline.test(r.text);
  console.log(`  ${keep ? "  " : "★ "} ${r.id}　${r.text.replace(/\s+/g, " ").slice(0, 96)}`);
}
