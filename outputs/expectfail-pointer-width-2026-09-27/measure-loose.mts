// 任务 #26 的现读：872 条锚点里，有多少根 expectFail 指针**只**靠"占位符展开的松模式"通过静态体检
// （即：逐字 `includes` 认不出，靠 vitestTitlePatterns 那条放宽的分支才认）。
// 这一格不为零就意味着"标题改了、指针没改"仍可能静默过关（本轮那条「四支／六支」就是这一族的一例）。
// 取料走 `mutate-verify.mjs --list`（表自己枚举的那条路），不 import、不手搓正则解析源文件——
// 上一版手搓解析在含引号的标题上 JSON.parse 崩过一次。
// 用法：node --import tsx "outputs/expectfail-pointer-width-2026-09-27/measure-loose.mts"
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const out = execFileSync(process.execPath, ["--import", "tsx", "scripts/mutate-verify.mjs", "--list"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const rows = out.split("\n").filter((l) => l.trim() !== "").map((l) => l.split("\t"));
const anchors = rows.map((c) => ({
  id: c[0] ?? "", src: c[1] ?? "", desc: c[2] ?? "", test: c[3] ?? "", pointer: safe(c[4] ?? '""'),
}));

function safe(raw: string): string {
  try {
    const v = JSON.parse(raw);
    return typeof v === "string" ? v : "";
  } catch {
    return "<<PARSE-FAIL>>";
  }
}

const PLACEHOLDER = /(\$\{[\s\S]*?\}|\$[A-Za-z_]\w*|%[sdijfovc#])/;
let looseOnly = 0, literal = 0, empty = 0, unreadable = 0, parseFail = 0;
const hits: string[] = [];
const cache = new Map<string, string | null>();
const read = (rel: string): string | null => {
  if (!cache.has(rel)) {
    try {
      cache.set(rel, readFileSync(rel, "utf8"));
    } catch {
      cache.set(rel, null);
    }
  }
  return cache.get(rel) ?? null;
};
for (const a of anchors) {
  if (a.pointer === "<<PARSE-FAIL>>") { parseFail++; continue; }
  if (a.pointer === "" || a.test === "") { empty++; continue; }
  const text = read(a.test);
  if (text === null) { unreadable++; continue; }
  if (text.includes(a.pointer)) { literal++; continue; }
  // 逐字认不出、但尺判"找得到" ⇒ 全靠松模式（或该 test 面本来就有别的逐字命中，已在上一支排掉）
  looseOnly++;
  hits.push(`  ${a.id}　${a.test}　▸ ${a.pointer.slice(0, 70)}`);
}
console.log(`表里 ${anchors.length} 条：指针为空/无 test ${empty} 条，判卷读不到 ${unreadable} 条，解析失败 ${parseFail} 条（这一格必须为 0，否则是取料面坏了）`);
console.log(`带指针的里面：逐字命中 ${literal} 条　只靠松模式 ${looseOnly} 条`);
for (const h of hits) console.log(h);

// 松到什么程度才算危险：把认下这根指针的那条**源标题**找出来，量它的字面残迹盖掉了指针的多少字符。
// 残迹占比高 ⇒ 只有拼接处（label 之类）允许漂，改名仍会喊；残迹短 ⇒ 一根几乎不相关的指针也能被认下。
const PLACEHOLDER_RE = /(\$\{[\s\S]*?\}|\$[A-Za-z_]\w*|%[sdijfovc#])/;
const titlesOf = (text: string): string[] => {
  const pats = [/\b(?:it|test)(?:\.each|\.skip|\.todo|\.only|\.fails|\.concurrent|\.sequential)?\s*\(\s*"((?:[^"\\]|\\.)*)"/g, /\b(?:it|test)(?:\.each|\.skip|\.todo|\.only|\.fails|\.concurrent|\.sequential)?\s*\(\s*`((?:[^`\\\\]|\\\\.)*)`/g];
  const out2: string[] = [];
  for (const re of pats) for (const m of text.matchAll(re)) out2.push(m[1]!);
  return out2;
};
const matchesTitle = (pointer: string, lit: string): boolean => {
  const un = lit.replace(/\\(.)/g, "$1");
  const body = un.split(PLACEHOLDER_RE).map((p) => (PLACEHOLDER_RE.test(p) ? "@@w@@" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp("^[\\s\\S]*" + body.split("@@w@@").join("[\\s\\S]*?") + "[\\s\\S]*$").test(pointer);
};
console.log("\n松模式的松紧度（残迹＝源标题去掉占位符后剩下的字面文字；占比越低越危险）");
for (const a of anchors) {
  if (a.pointer === "" || a.pointer === "<<PARSE-FAIL>>" || a.test === "") continue;
  const text = read(a.test);
  if (text === null || text.includes(a.pointer)) continue;
  const winner = titlesOf(text).find((t) => matchesTitle(a.pointer, t)) ?? "";
  const residue = winner.replace(/\\(.)/g, "$1").split(PLACEHOLDER_RE).map((p) => (PLACEHOLDER_RE.test(p) ? "" : p)).join("");
  const pct = a.pointer.length === 0 ? 0 : Math.round((residue.length / a.pointer.length) * 100);
  console.log(`  ${String(pct).padStart(3)}%　${a.id}　残迹 ${residue.length}/${a.pointer.length} 字　源标题=${JSON.stringify(winner).slice(0, 74)}`);
}
