import { buildImpact, upward } from "/Users/ze/Downloads/deepseek harness/.worktrees/p170-tighten/src/agent/impact/index";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/ze/Downloads/deepseek harness/.worktrees/verify-dd3af4e";
const graph = await buildImpact({ workspace: ROOT, cacheDir: "/tmp/impact-probe-cache", maxFiles: 5000 });

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
}
const files: string[] = [];
for (const d of ["src", "scripts", "tests"]) walk(join(ROOT, d), files);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*(\/\/|\*|#)/.test(l)).join("\n");
}
const syms = process.argv.slice(2);
let fp = 0, fn = 0, checked = 0;
for (const sym of syms) {
  const reported = new Set(upward(graph, sym).map((s: { file: string }) => s.file));
  const defs = new Set(((graph.defs.get(sym) ?? []) as { file: string }[]).map((d) => d.file));
  const ground = new Set<string>();
  for (const abs of files) {
    const rel = abs.slice(ROOT.length + 1);
    if (defs.has(rel)) continue;
    const code = stripComments(readFileSync(abs, "utf8"));
    if (new RegExp(`\\b${sym}\\b`, "u").test(code)) ground.add(rel);
  }
  const missed = [...ground].filter((f) => !reported.has(f)).sort();
  const extra = [...reported].filter((f) => !ground.has(f)).sort();
  checked += 1; fn += missed.length; fp += extra.length;
  console.log(`${sym}: 定义处=${[...defs].join(",") || "?"}  应有引用方=${String(ground.size)}  impact 报=${String(reported.size)}  漏=${String(missed.length)}  多报=${String(extra.length)}`);
  if (missed.length) console.log("    漏: " + missed.slice(0, 6).join(", "));
  if (extra.length) console.log("    多报: " + extra.slice(0, 6).join(", "));
}
console.log(`SUMMARY 符号数=${String(checked)} 漏报合计=${String(fn)} 多报合计=${String(fp)}  图内文件=${String((graph as { files: unknown[] }).files.length)}`);
