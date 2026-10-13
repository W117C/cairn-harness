// 「换单价不换语义」的逐位取证：同一批文件，HEAD 版与修复版的 extractLiterals / scanRepo 全等比对。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import * as HEAD from "./head-prose-needle-scan.ts";
import * as FIXED from "../../scripts/prose-needle-scan.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const list = (prefixes: readonly string[], exts: readonly string[]) =>
  execFileSync("git", ["ls-files", "-z", ...prefixes], { encoding: "utf8", cwd: root })
    .split("\0").filter((p) => p !== "" && exts.some((e) => p.endsWith(e)));

const files = [...list(["tests"], [".test.ts"]), ...list(["src", "scripts"], [".ts", ".mts", ".mjs"])];
let chunks = 0, mismatchedFiles = 0, mismatchedChunks = 0;
for (const p of files) {
  const text = readFileSync(resolve(root, p), "utf8");
  const a = HEAD.extractLiterals(p, text);
  const b = FIXED.extractLiterals(p, text);
  chunks += a.length;
  if (isDeepStrictEqual(a, b)) continue;
  mismatchedFiles += 1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (!isDeepStrictEqual(a[i], b[i])) mismatchedChunks += 1;
  console.log("MISMATCH " + p + "  HEAD=" + String(a.length) + " FIXED=" + String(b.length));
}
console.log("chunks compared: " + String(chunks) + " over " + String(files.length) + " files");
console.log("mismatched files: " + String(mismatchedFiles) + "  mismatched chunks: " + String(mismatchedChunks));

const ra = HEAD.scanRepo(root);
const rb = FIXED.scanRepo(root);
console.log("scanRepo reports deep-equal: " + String(isDeepStrictEqual(ra, rb)));
if (!isDeepStrictEqual(ra, rb)) {
  for (const k of Object.keys(ra)) if (!isDeepStrictEqual(ra[k], rb[k])) console.log("FIELD DIFFERS: " + k);
}
const verdict = mismatchedFiles === 0 && isDeepStrictEqual(ra, rb);
console.log(verdict ? "VERDICT: IDENTICAL" : "VERDICT: DIFFERS");
process.exitCode = verdict ? 0 : 1;
