// 阶段剖析：同一份剖面脚本，吃 `SCAN_MODULE` 指向的实现（HEAD 版／修复版），输出可直接 diff。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const mod = process.env.SCAN_MODULE ?? "../../scripts/prose-needle-scan";
const M = await import(mod);
const {
  applyWaivers, classifyNeedles, collectNeedles, DOC_PROSE_KEYS, extractLiterals,
  SELF_EXCLUDED_TESTS, shadowFilesOf, splitAged, treeScopeOf, scanRepo,
} = M;

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const pickByExts = (raw: string, exts: readonly string[]) =>
  raw.split("\0").filter((p) => p !== "" && exts.some((e) => p.endsWith(e)));
const trackedFiles = (prefixes: readonly string[], exts: readonly string[]) =>
  pickByExts(execFileSync("git", ["ls-files", "-z", ...prefixes], { encoding: "utf8", cwd: root }), exts);
const untrackedFiles = (prefixes: readonly string[], exts: readonly string[]) => {
  const raw = execFileSync("git", ["ls-files", "-z", "--others", "--exclude-standard", "--", ...prefixes], { encoding: "utf8", cwd: root });
  return pickByExts(raw, exts);
};
const inFlightPaths = () => {
  const raw = execFileSync("git", ["status", "--porcelain", "-z"], { encoding: "utf8", cwd: root });
  const out = new Set<string>();
  for (const rec of raw.split("\0")) { if (rec.length < 4) continue; out.add(rec.slice(3).split(" -> ").pop()!); }
  return out;
};
const t0 = performance.now();
const mark = (label: string, since: number) => {
  const now = performance.now();
  console.log(String(Math.round(now - since)).padStart(6) + " ms  " + label + "   (t+" + Math.round(now - t0) + ")");
  return now;
};
let t = t0;
const load = (list: readonly string[]) => list.map((p) => ({ path: p, text: readFileSync(resolve(root, p), "utf8") }));

const allTests = trackedFiles(["tests"], [".test.ts"]); t = mark("git ls-files tests", t);
const testFiles = load(allTests.filter((p) => !SELF_EXCLUDED_TESTS.includes(p))); t = mark("read " + testFiles.length + " test files", t);
const allSources = trackedFiles(["src", "scripts"], [".ts", ".mts", ".mjs"]); t = mark("git ls-files src,scripts", t);
const sources = load(allSources); t = mark("read " + sources.length + " source files", t);
const utTests = untrackedFiles(["tests"], [".test.ts"]); t = mark("untracked tests (" + utTests.length + ")", t);
const utSources = untrackedFiles(["src", "scripts"], [".ts", ".mts", ".mjs"]); t = mark("untracked sources (" + utSources.length + ")", t);
const collected = testFiles.map((f) => collectNeedles(f.path, f.text)); t = mark("collectNeedles x" + testFiles.length, t);
const needles = collected.flatMap((c) => c.needles);
console.log("       needles=" + needles.length);
const verdicts = classifyNeedles(needles, sources, new Map(testFiles.map((f) => [f.path, f.text]))); t = mark("classifyNeedles", t);
const { rows, stale } = applyWaivers(verdicts); t = mark("applyWaivers (" + rows.length + " rows, " + stale.length + " stale)", t);
const anchorTables = shadowFilesOf(sources); t = mark("shadowFilesOf (2nd pass)", t);
const anchorSet = new Set(anchorTables.filter((x) => x.kind === "登记表").map((x) => x.path));
const proseHeldBack = sources.filter((s) => anchorSet.has(s.path))
  .reduce((a, s) => a + extractLiterals(s.path, s.text).filter((c) => DOC_PROSE_KEYS.includes(c.key)).length, 0); t = mark("proseHeldBack extractLiterals over " + anchorSet.size + " anchor tables", t);
const fly = inFlightPaths(); t = mark("inFlightPaths (" + fly.size + ")", t);
splitAged([...fly], (f) => { try { return statSync(resolve(root, f)).mtimeMs; } catch { return null; } }, Date.now()); t = mark("splitAged stat", t);
treeScopeOf(existsSync(resolve(root, "src/renderer"))); t = mark("treeScopeOf", t);
console.log("STAGES " + Math.round(performance.now() - t0) + " ms");
t = performance.now();
const r = scanRepo(root);
console.log("scanRepo one-shot " + Math.round(performance.now() - t) + " ms");
console.log("READINGS " + JSON.stringify({ needles: r.needles, testFiles: r.testFiles, sourceFiles: r.sourceFiles, counts: r.counts, multiCopy: r.multiCopy.length, bareName: r.bareName.length, drift: r.drift.length, proseHeldBack: r.proseHeldBack, anchorTables: r.anchorTables.length, maskedSameSentence: r.maskedSameSentence, maskedSharedWord: r.maskedSharedWord }));
