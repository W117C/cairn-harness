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
  // 按**类型化的键**逐字段比：写成 `ra[k]`（k: string）会在证据面判卷里落一条 TS7053
  // （按字符串下标取不存在的键＝会静默交出 undefined 的那一族，第 472 页落地时 CI 当场红过）。
  const keys = Object.keys(ra) as (keyof typeof ra)[];
  for (const k of keys) if (!isDeepStrictEqual(ra[k], rb[k])) console.log("FIELD DIFFERS: " + String(k));
}
const verdict = mismatchedFiles === 0 && isDeepStrictEqual(ra, rb);
console.log(verdict ? "VERDICT: IDENTICAL" : "VERDICT: DIFFERS");
process.exitCode = verdict ? 0 : 1;
