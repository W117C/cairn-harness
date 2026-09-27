// 现读：整仓判卷面里有多少文件带"整条标题都是占位符"的动态标题 ⇒ 那些文件的 expectFail 静态体检是恒真的。
// 这把尺开张前先量现读（规则 222），并顺手给出"改完之后会有多少根指针新报 not-found"。
// 用法：node --import tsx "outputs/expectfail-pointer-width-2026-09-27/measure-vacuous.mts"
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { vitestTitles, expectFailMatchesTitles } from "../../scripts/lib/mutate-gates.ts";

const PLACEHOLDER = /(\$\{[\s\S]*?\}|\$[A-Za-z_]\w*|%[sdijfovc#])/;
// split 带**捕获组**时会把分隔符本身也塞进数组 ⇒ 直接 join("") 等于把原文抄回来（我第一版就是这么读出满屏 0 的）。
// 要的是"去掉占位符后的字面残迹"，所以逐段问一次，是占位符的那段丢弃。
const residue = (lit: string): string =>
  lit
    .replace(/\\(.)/g, "$1")
    .split(PLACEHOLDER)
    .map((p) => (PLACEHOLDER.test(p) ? "" : p))
    .join("");

const tableSrc = readFileSync("scripts/mutate-verify.mjs", "utf8");
const files = execFileSync("git", ["ls-files", "tests"], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".test.ts"));

let vacuousFiles = 0;
const rows: string[] = [];
for (const f of files) {
  let src: string;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const vac = vitestTitles(src).filter((t) => residue(t) === "");
  if (vac.length > 0) {
    vacuousFiles++;
    rows.push(`  ${f}　动态标题 ${vac.length} 条　例：${JSON.stringify(vac[0])}`);
  }
}
console.log(`判卷文件 ${files.length} 个，其中含「整条标题都是占位符」的文件 ${vacuousFiles} 个 ⇒ 这些文件的静态指针体检恒真`);
for (const r of rows) console.log(r);

// 锚点表按 test 分组，量"落在恒真文件上的锚点有几条"
const anchors = [...tableSrc.matchAll(/^\s{4}id: "([\w-]+)",\n\s{4}src: "[^"]*",\n(?:\s{4}\w+: .*?\n)*?(?:\s{4}test: "([^"]*)",)?/gm)];
const byId = new Map<string, string>();
for (const m of anchors) if (m[2]) byId.set(m[1], m[2]);
const vacSet = new Set(rows.map((r) => r.trim().split("　")[0]));
const onVacuous = [...byId.entries()].filter(([, t]) => vacSet.has(t));
console.log(`正则粗取锚点 ${byId.size} 条（带 test 字段者）⇒ 落在恒真文件上的 ${onVacuous.length} 条`);
console.log(`（这条粗取只用于量面，条数与真表以 mutate-verify 自己的枚举为准）`);

// 逐字证明恒真：拿一根绝对不存在的指针去问共享谓词
const probeFile = "tests/mutate-verify-gates.test.ts";
const s = readFileSync(probeFile, "utf8");
const bogus = "这句话在仓库里不存在 ZZZ-9x7";
console.log(`对 ${probeFile} 问一根不存在的指针 ⇒ expectFailMatchesTitles = ${expectFailMatchesTitles(bogus, s)}（true ⇒ 该文件的体检已被一条动态标题整体缴械）`);
