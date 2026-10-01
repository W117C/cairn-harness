/** 第 277 页探针：哪几种形状真会让 `operandInsideParens` 走不通（＝`unresolved` 累加），
 *  而不是只靠我推理。每种形状都单独印「收到几条／unresolved 几条」，两半都要看得见。 */
import { collectNeedles } from "../../scripts/prose-needle-scan.ts";

const cases: [string, string][] = [
  ["基准（走得通）", `expect(String(g.reason)).toContain("基准那条料");`],
  ["无诊断字段的 operand", `expect(w).toContain("没有字段那条料");`],
  ["裸右括号开头（前面没有左括号）", `probeArg).toContain("裸括号那条料");`],
  ["前面一个字符串里有右括号", `const pad = ")";\nexpect(String(g.why)).toContain("串里有括号那条料");`],
  ["三层右括号只有一层左", `a(b))c).toContain("三层那条料");`],
];

for (const [name, text] of cases) {
  const r = collectNeedles("p.test.ts", text);
  console.log(`${name} ⇒ 收到 ${String(r.needles.length)} 条（${r.needles.map((v) => v.needle).join("、") || "无"}）｜unresolved=${String(r.unresolved)}`);
}
