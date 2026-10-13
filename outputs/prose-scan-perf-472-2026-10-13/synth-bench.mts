import { performance } from "node:perf_hooks";
import ts from "typescript";
import { extractLiterals } from "../../scripts/prose-needle-scan";

const FN_HEAD = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)/g;
function enclosingFnOld(text: string, at: number): string {
  let fn = "(top)";
  for (const m of text.slice(0, at).matchAll(FN_HEAD)) fn = m[1] ?? m[2] ?? fn;
  return fn;
}
function headsOf(text: string): { end: number; name: string }[] {
  return [...text.matchAll(FN_HEAD)].map((m) => ({ end: m.index + m[0].length, name: m[1] ?? m[2] ?? "(top)" }));
}
function enclosingFnNew(heads: { end: number; name: string }[], at: number): string {
  let lo = 0, hi = heads.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (heads[mid]!.end <= at) lo = mid + 1; else hi = mid; }
  return lo === 0 ? "(top)" : heads[lo - 1]!.name;
}

// 合成夹具：N 段函数，每段 m 条字面量。老实现是 O(L × S)，新实现是 O(S + L log H)。
const FUNCS = 600, PER = 20; // 12,000 条字面量
let text = "";
for (let i = 0; i < FUNCS; i++) {
  text += `export function fn${i}(): string {\n`;
  for (let j = 0; j < PER; j++) text += `  const s${i}_${j} = "第 ${i}-${j} 句生产文案，用来量单价";\n`;
  text += "  return \"\";\n}\n";
}
console.log("fixture " + Math.round(text.length / 1024) + " KB, " + (FUNCS * PER) + " literals");
const source = ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true);
const K = ts.SyntaxKind;
const positions: number[] = [];
const walk = (node: ts.Node): void => {
  if (node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral || node.kind === K.TemplateTail) { positions.push(node.getStart(source)); return; }
  if (node.kind === K.TemplateHead || node.kind === K.TemplateMiddle) { positions.push(node.getStart(source)); return; }
  node.forEachChild(walk);
};
source.statements.forEach(walk);
console.log("literals walked: " + positions.length);
let t = performance.now();
let acc = 0; for (const p of positions) acc += enclosingFnOld(text, p).length;
console.log("OLD enclosingFn  " + Math.round(performance.now() - t) + " ms (acc " + acc + ")");
const heads = headsOf(text);
t = performance.now();
acc = 0; for (const p of positions) acc += enclosingFnNew(heads, p).length;
console.log("NEW enclosingFn  " + Math.round(performance.now() - t) + " ms (acc " + acc + ")");
t = performance.now(); const { chunks } = { chunks: extractLiterals("synth.ts", text) }; console.log("extractLiterals(CURRENT code) " + Math.round(performance.now() - t) + " ms (" + chunks.length + " chunks)");
