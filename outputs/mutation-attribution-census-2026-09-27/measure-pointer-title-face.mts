// 一次性读数（第 141 页）：killer 指针到底指的是「用例标题」，还是判卷文件里随便一句字符串。
// 口径：只喂 `vitestTitlePatterns`（标题那一半），不走 `expectFailMatchesTitles` 的「整文件逐字命中」那条短路
// —— 后者正是静态尺的洞：`auditExpectFails` 允许指针命中注释/断言文本，静态绿而运行时永远对不上用例。
// 跑法：node --import tsx outputs/mutation-attribution-census-2026-09-27/measure-pointer-title-face.mts
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { vitestTitlePatterns, vitestTitles } from "../../scripts/lib/mutate-gates.ts";

const listed = spawnSync(process.execPath, ["scripts/mutate-verify.mjs", "--list"], {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
const rows = (listed.stdout ?? "").split("\n").map((l) => l.split("\t"))
  .filter((p) => p.length >= 5 && (p[4] ?? "").startsWith("\""))
  .map((p) => ({ id: p[0] ?? "", test: p[3] ?? "", expectFail: JSON.parse(p[4] ?? '""') as string }));

const withPointer = rows.filter((x) => x.expectFail !== "" && x.test.endsWith(".test.ts"));
// `--list` 读出的行数 vs 表里 `id:` 的条数：真表自证与静态尺都吃 `--list` 这份取料面，
// 少一条＝那条锚点对两把尺同时隐形（标题里含制表符/换行就会这样）。
const tableIds = (readFileSync("scripts/mutate-verify.mjs", "utf8").match(/^\s+id: "/gm) ?? []).length;
console.log(`表内 id: 条数 ${String(tableIds)} ｜ --list 读出 ${String(rows.length)} 条${tableIds === rows.length ? "（对齐）" : " ⇒ 有锚点对吃 --list 的两把尺隐形"}`);

const cache = new Map<string, { patterns: RegExp[]; titles: string[]; suites: string[]; text: string }>();
const notTitle: string[] = [];
for (const x of withPointer) {
  if (!cache.has(x.test)) {
    let text = "";
    try { text = readFileSync(x.test, "utf8"); } catch { text = ""; }
    cache.set(x.test, {
      patterns: vitestTitlePatterns(text),
      titles: vitestTitles(text),
      suites: [...text.matchAll(/describe(?:\.\w+)*\(\s*"([^"]+)"/g)].map((m) => m[1] ?? ""),
      text,
    });
  }
  const { patterns, titles, suites, text } = cache.get(x.test)!;
  // 指针要能落到运行时那一行上。三种"看起来不像标题"的其实是标题（第一版把它们报成假缺陷）：
  //  ① 指针是某条标题的子串（运行时印的是整条）；
  //  ② 指针是 `describe` 那一层的套件名——FAIL 行是 `file > 套件 > 用例`，套件名确实在里面；
  //  ③ 标题是**循环生成的**（`for (const cmd of WRAPPED) it(cmd, …)`）⇒ 静态抽不出，运行时它是真标题，
  //     这一支的见证＝判卷文件里有一行**独立成行的字符串字面量**恰好等于指针（那份候选数组）。
  const escaped = x.expectFail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const loopGeneratedTitle = new RegExp(`^\\s*"${escaped}",\\s*$`, "m").test(text);
  const ok = patterns.some((re) => re.test(x.expectFail))
    || titles.some((t) => t.includes(x.expectFail))
    || suites.includes(x.expectFail)
    || loopGeneratedTitle;
  if (!ok) notTitle.push(`${x.id}\t${x.test}\t${x.expectFail.slice(0, 60)}`);
}
console.log(`声明了 killer 指针且判卷是 .test.ts：${String(withPointer.length)}`);
console.log(`指针指不到任何用例标题（既非某条标题、也不是某条标题的子串）：${String(notTitle.length)}`);
for (const l of notTitle) console.log("  " + l);
