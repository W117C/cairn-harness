import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { extractLiterals } from "../../scripts/prose-needle-scan";
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const raw = execFileSync("git", ["ls-files", "-z", "src", "scripts"], { encoding: "utf8", cwd: root });
const files = raw.split("\0").filter((p) => p && [".ts", ".mts", ".mjs"].some((e) => p.endsWith(e)));
const rows: { p: string; ms: number; kb: number; chunks: number }[] = [];
let total = 0;
for (const p of files) {
  const text = readFileSync(resolve(root, p), "utf8");
  const t = performance.now();
  const chunks = extractLiterals(p, text);
  const ms = performance.now() - t;
  total += ms;
  rows.push({ p, ms, kb: Math.round(text.length / 1024), chunks: chunks.length });
}
rows.sort((a, b) => b.ms - a.ms);
console.log("total " + Math.round(total) + " ms over " + files.length + " files");
for (const r of rows.slice(0, 15)) console.log(String(Math.round(r.ms)).padStart(6) + " ms  " + String(r.kb).padStart(5) + " KB  " + String(r.chunks).padStart(5) + " chunks  " + r.p);
