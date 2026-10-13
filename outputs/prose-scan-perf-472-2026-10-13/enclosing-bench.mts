import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { lex, extractLiterals } from "../../scripts/prose-needle-scan";

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

const path = "scripts/mutate-verify.mjs";
const text = readFileSync(path, "utf8");
let t = performance.now();
const { code, source } = lex(text);
console.log("lex            " + Math.round(performance.now() - t) + " ms");
t = performance.now();
const heads = headsOf(code);
console.log("headsOf        " + Math.round(performance.now() - t) + " ms  (" + heads.length + " heads)");
// collect literal positions from the tree (same walk as extractLiterals, but only positions)
const K = ts.SyntaxKind;
const positions: number[] = [];
const walk = (node: ts.Node): void => {
  if (node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral || node.kind === K.TemplateTail) { positions.push(node.getStart(source)); return; }
  if (node.kind === K.TemplateHead || node.kind === K.TemplateMiddle) { positions.push(node.getStart(source)); return; }
  node.forEachChild(walk);
};
t = performance.now(); source.statements.forEach(walk);
console.log("walk+getStart   " + Math.round(performance.now() - t) + " ms  (" + positions.length + " literals)");
t = performance.now();
let acc = 0; for (const p of positions) acc += enclosingFnOld(code, p).length;
console.log("OLD enclosingFn " + Math.round(performance.now() - t) + " ms  (acc " + acc + ")");
t = performance.now();
acc = 0; for (const p of positions) acc += enclosingFnNew(heads, p).length;
console.log("NEW enclosingFn " + Math.round(performance.now() - t) + " ms  (acc " + acc + ")");
// equivalence check on every literal position
let mismatch = 0;
for (const p of positions) if (enclosingFnOld(code, p) !== enclosingFnNew(heads, p)) mismatch++;
console.log("mismatches      " + mismatch);
t = performance.now(); extractLiterals(path, text); console.log("extractLiterals " + Math.round(performance.now() - t) + " ms");
