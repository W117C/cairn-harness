import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIRS = [
  "fixtures/no-progress", "fixtures/agents", "fixtures/mock", "fixtures/autonomy",
  "fixtures/gate", "fixtures/demo", "fixtures/gym/cases",
];
function walk(d: string, acc: string[]): string[] {
  let names: string[] = [];
  try { names = readdirSync(d, { withFileTypes: false }).map(String); } catch { return acc; }
  for (const n of names) {
    const p = join(d, n);
    let isDir = false;
    try { isDir = readdirSync(p).length >= 0; } catch { /* file */ }
    if (isDir) walk(p, acc); else if (n.endsWith(".jsonl")) acc.push(p);
  }
  return acc;
}
const files: string[] = [];
for (const d of DIRS) walk(d, files);
let n = 0, bytes = 0;
const byFile = new Map<string, number>();
for (const f of files) {
  let c = 0;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (e["type"] !== "tool_result") continue;
    const out = String(e["output"] ?? "");
    n++; c++; bytes += Buffer.byteLength(out, "utf8");
  }
  if (c > 0) byFile.set(f, c);
}
console.log(`files scanned ${files.length} · with tool_result ${byFile.size}`);
console.log(`tool_result ${n} 条 / ${bytes} 字节`);
for (const [f, c] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${c}  ${f}`);
