// 第 305 页的造红台（一次性取证脚本，跑完即复原 ⇒ 不进 package.json 的门表）。
//
// 与第 302 页那台的**唯一**差别，也是这台存在理由：改法**不手抄**，直接从
// `scripts/mutate-verify.mjs` 的锚点表里把 (id, src, 针脚, 改后, expectFail) 解出来。
// 上一台是我手写的七条机器 ⇒ 表与机器是两份文字，针脚漂了机器照样「红得漂亮」，
// 那红证明的是我抄的那份，不是入库的那份（规则 236：探针自己再算一遍＝假读数）。
//
// 每台核四件事：
//   ⑴ 针脚在被改文件里**恰好 1 处**（0＝空操作，2＝钉不准）；
//   ⑵ 这一台红的用例集里**必须包含它自己声明的 killer**（否则 expectFail 是吹的）；
//   ⑶ 14 台的 killer 两两不同（同一条用例被两台指着＝其中一台没分辨力）；
//   ⑷ 复原后与备份**逐字节相同**（`cmp`），最后再全量复查残骸＝0。
// 读 vitest 汇总前先 stripAnsi（复用 scripts/lib/vitest-summary.ts，不另抄正则）。
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..", "..");
const { vitestSummary } = await import(pathToFileURL(resolve(ROOT, "scripts/lib/vitest-summary.ts")).href);

const TABLE = readFileSync(resolve(ROOT, "scripts/mutate-verify.mjs"), "utf8");

/** 这三笔（305/306/307）那 18 条按 id 点名（不按"表尾几条"这种位置取——位置会被隔壁的插入挪走）。
 *  第 15 条＝第 306 页新加的租约闭包锚点；第 16 条是**重指过针脚的老锚点**
 *  （`impact-closure-glob-broken`：那段循环抽成 `closureFilesOf`，针脚跟着搬到入面那一行）。
 *  重指过的针脚必须重新杀一次：`--check-needles` 只答"针脚在不在源文件里"，答不出"还咬不咬得住那条用例"。 */
const IDS = [
  "impact-attribution-no-evidence-read-as-kept",
  "impact-attribution-positive-proof-ignored",
  "impact-attribution-only-first-source-counted",
  "impact-attribution-reverse-proof-never-drops",
  "impact-attribution-note-dropped-only-gauge",
  "impact-attribution-note-prints-zeros",
  "impact-edges-not-filtered-by-attribution",
  "impact-upward-attribution-not-applied",
  "impact-downward-attribution-not-applied",
  "impact-attribution-note-not-wired",
  "impact-tags-cache-imports-guard-dropped",
  "impact-imports-exit-not-eaten",
  "impact-index-artifact-namesources-not-saved",
  "impact-index-artifact-version-not-checked",
  "impact-lease-closure-bypasses-attribution",
  "impact-closure-glob-broken",
  "impact-mixed-sites-not-counted",
  "impact-mixed-sites-not-in-note",
  "impact-query-union-note-denies-imports",
  "impact-query-deps-arm-loses-attribution",
  "impact-query-symbol-arm-loses-attribution",
  "impact-query-file-arm-loses-denominator",
  "impact-query-notes-land-before-the-count",
  "impact-query-empty-list-loses-notes",
  "impact-mixed-note-prints-zeros",
  // 第 309 页那三枚（`web_fetch` 截断提示里的假出路）：同一台机器跑到底，别再开一份新台账。
  "web-hint-offers-anchor-as-a-way-to-narrow",
  "web-hint-drops-fragment-explanation",
  "web-fetch-hint-computed-not-wired",
  // 第 309 页后半簇：判定归属的登记与"登记名打错＝顶包"那一格。
  "promise-web-face-left-unregistered",
  "promise-runner-name-typo-gets-anothers-verdict",
  // 第 310 页那一簇：把「附件=0 条」拆成三栏分母的那把尺（分类函数／第三栏／报告／登记四面）。
  "prune-stub-classifier-fails-open",
  "prune-stub-third-column-drops-workspace",
  "prune-stub-report-hides-a-column",
  "prune-stub-face-left-unregistered",
  // 第 311 页那一簇：能力断言的证人面（受众判定／候选段门槛／帽两半／整句收料不重复计数）。
  "claim-audience-nearest-call-only",
  "claim-witness-run-threshold-collapsed",
  "claim-cap-stale-branch-dropped",
  "claim-cap-over-branch-dropped",
  "claim-whole-sentence-piece-double-count",
  // 第 312 页那一簇：`evidence-line:` 空指针这一支（解析层那道闸 + 注入层不许现造 digest）。
  "lesson-empty-evidence-gate-dropped",
  "lesson-inject-fabricates-empty-digest",
];

// 一个 JS 字符串字面量的正则形状（双引号、单引号两支）。本笔 14 条改法都不含反引号写法，
// 所以刻意**不支第三支**：解不出来就当场抛，不静默解成半截。
const LIT = "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')";
const evalLit = (lit) => new Function("return " + lit)();

/** 从表里解出一条锚点：id 之后到第一个 `\n  },` 为界，src/test/expectFail 各取第一条，
 *  改法取 `.replace(<字面量>, <字面量>)` 的两个字面量（跨行写法由 s 位覆盖）。 */
function parseEntry(id) {
  const at = TABLE.indexOf(`id: "${id}",`);
  if (at < 0) throw new Error(`锚点表里找不到 ${id}`);
  const end = TABLE.indexOf("\n  },", at);
  const seg = TABLE.slice(at, end < 0 ? TABLE.length : end);
  const src = /src:\s*"([^"]+)"/u.exec(seg)?.[1];
  const test = /test:\s*"([^"]+)"/u.exec(seg)?.[1];
  const killer = new RegExp(`expectFail:\\s*${LIT}`, "su").exec(seg)?.[1];
  const rep = new RegExp(`\\.replace\\(\\s*${LIT}\\s*,\\s*${LIT}`, "su").exec(seg);
  if (!src || !test || !killer || !rep) throw new Error(`${id}：表里解不出 src/test/expectFail/改法`);
  return { id, src, test, killer: evalLit(killer), old: evalLit(rep[1]), next: evalLit(rep[2]) };
}

const ENTRIES = IDS.map(parseEntry);
console.log(`# 解表：${String(ENTRIES.length)} 条，全部取自 scripts/mutate-verify.mjs（本机未手抄任何改法）`);
for (const e of ENTRIES) {
  console.log(`  ${e.id}\n    src=${e.src} test=${e.test}`);
  console.log(`    针脚=${JSON.stringify(e.old)} → 改后=${JSON.stringify(e.next)}`);
}

function runVitest(testFile: string) {
  let out = "";
  let code = 0;
  try {
    out = execFileSync("node", [
      "node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", testFile,
    ], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
  } catch (err) {
    out = String(err.stdout ?? "") + String(err.stderr ?? "");
    code = typeof err.status === "number" ? err.status : -1;
  }
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  const failed = plain.split("\n").filter((l) => /^\s+×/u.test(l)).map((l) => l.trim().slice(2));
  return {
    code,
    summary: vitestSummary(out),
    failed,
    duration: /Duration\s+([\d.]+\s*m?s)/u.exec(plain)?.[1] ?? "?",
  };
}

console.log(`\n# 基准（未改任何文件；每台跑自己那条判卷文件，所以逐个文件都要先绿）`);
for (const tf of [...new Set(ENTRIES.map((e) => e.test))]) {
  const base = runVitest(tf);
  console.log(`  ${tf}：exit=${String(base.code)} tests=${JSON.stringify(base.summary)} 用时=${base.duration}`);
  if (base.code !== 0 || base.summary.found === false || base.summary.failed !== 0) {
    console.log(`  ❌ ${tf} 基准不绿 ⇒ 落在它上面的每台红都说明不了任何事，先修基准`);
    process.exit(1);
  }
}
console.log("  ✅ 全部基准绿");

const BAKDIR = `/tmp/dsh-impact-attrib-red-${String(process.pid)}`;
mkdirSync(BAKDIR, { recursive: true });
const touched = [...new Set(ENTRIES.map((e) => e.src))];
for (const rel of touched) copyFileSync(resolve(ROOT, rel), resolve(BAKDIR, rel.replace(/\//gu, "_") + ".bak"));

const rows = [];
for (const e of ENTRIES) {
  const path = resolve(ROOT, e.src);
  const src = readFileSync(path, "utf8");
  const hits = src.split(e.old).length - 1;
  process.stdout.write(`\n# ${e.id}  ${e.src}  针脚命中=${String(hits)} 处\n`);
  if (hits !== 1) {
    console.log("  ❌ 针脚不是恰好 1 处 ⇒ 这台不作分辨力证据（跳过，不改文件）");
    rows.push({ ...e, hits, killed: false, note: "针脚不唯一", failedCases: [] });
    continue;
  }
  writeFileSync(path, src.replace(e.old, e.next), "utf8");
  const run = runVitest(e.test);
  copyFileSync(resolve(BAKDIR, e.src.replace(/\//gu, "_") + ".bak"), path);
  const restoredOk = readFileSync(path, "utf8") === readFileSync(resolve(BAKDIR, e.src.replace(/\//gu, "_") + ".bak"), "utf8");
  const killed = run.failed.some((t) => t.includes(e.killer));
  console.log(`  exit=${String(run.code)} failed=${String(run.failed.length)} 复原=${restoredOk ? "逐字节一致 ✅" : "❌ 不一致"}`);
  console.log(`  killer「${e.killer.slice(0, 40)}…」${killed ? "红在它自己那条 ✅" : "没红 ❌（这台存活）"}`);
  for (const t of run.failed) console.log(`    × ${t}`);
  rows.push({ ...e, hits, killed, restoredOk, note: "", failedCases: run.failed, duration: run.duration });
}

console.log(`\n# killer 独占性（两台红在同一条＝其中一条没分辨力）`);
const seen = new Map();
for (const r of rows) seen.set(r.killer, (seen.get(r.killer) ?? 0) + 1);
const dup = [...seen.entries()].filter(([, n]) => n > 1);
console.log(`  ${String(rows.length)} 台 → ${String(seen.size)} 个不同 killer；重复声明：${dup.length === 0 ? "0 ✅" : dup.map(([k, n]) => `${k}×${String(n)}`).join("｜")}`);
console.log(`  存活台：${rows.filter((r) => !r.killed).length === 0 ? "0 ✅" : rows.filter((r) => !r.killed).map((r) => r.id).join("｜")}`);

console.log(`\n# 残骸复查（复原后三个被测面必须与备份逐字节相同）`);
let residue = 0;
for (const rel of touched) {
  const bak = resolve(BAKDIR, rel.replace(/\//gu, "_") + ".bak");
  const same = readFileSync(resolve(ROOT, rel), "utf8") === readFileSync(bak, "utf8");
  if (!same) residue += 1;
  console.log(`  ${rel}: ${same ? "与备份一致 ✅" : "❌ 有残骸"}`);
}
for (const rel of touched) rmSync(resolve(BAKDIR, rel.replace(/\//gu, "_") + ".bak"), { force: true });
rmSync(BAKDIR, { recursive: true, force: true });
console.log(`\n# 汇总：${String(rows.length)} 台｜杀手命中 ${String(rows.filter((r) => r.killed).length)}｜存活 ${String(rows.filter((r) => !r.killed).length)}｜残骸 ${String(residue)}`);
process.exit(residue === 0 && rows.every((r) => r.killed) ? 0 : 1);
