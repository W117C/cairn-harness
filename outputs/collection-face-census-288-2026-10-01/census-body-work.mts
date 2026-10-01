// 静态普查：判卷文件里「收集期」（describe 体）做的重活。
// 口径：语句直接挂在某个 describe 的回调体里（不在 it／钩子的闭包中），且调用会动盘、动进程或读全仓的入口。
// 规则 352 把这一族变成可复跑的读数；本脚本自带哨兵（argv 传改前那份文件，必须命中）。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HEAVY = /\b(scanRepo|scanProseNeedles|execFileSync|execSync|spawnSync|mkdtempSync|readFileSync|readdirSync|trackedFiles|writeFileSync|existsSync)\s*\(/;
const HOOK_OR_IT = /^ {2}(beforeAll|beforeEach|afterAll|afterEach|it|test)(\.\w+)?\(/;
const TOP_DESCRIBE = /^describe\(/;

const argv = process.argv.slice(2);
const files = argv.length > 0
  ? argv
  : execFileSync("git", ["ls-files", "--", "tests"], { encoding: "utf8" })
      .split("\n").filter((p) => p.endsWith(".test.ts"));

const rows: { file: string; line: number; text: string }[] = [];
for (const f of files) {
  // 逐行扫，靠花括号净数推深度：进入顶层 describe 那一行之后，深度＝1 的语句就活在收集期。
  let insideTopDescribe = false;
  let depth = 0;
  let topDepth = 0;
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!insideTopDescribe && TOP_DESCRIBE.test(l)) insideTopDescribe = true;
    if (!insideTopDescribe) continue;
    const net = (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
    const depthHere = depth;      // 这一行**开头**所在的深度
    depth += net;
    if (depthHere === 0 && /^\}/.test(l)) { insideTopDescribe = false; topDepth = depth; continue; }
    const isBodyStatement = depthHere === topDepth + 1 && /^ {2}\S/.test(l);
    if (isBodyStatement && !HOOK_OR_IT.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l) && HEAVY.test(l)) {
      rows.push({ file: f, line: i + 1, text: l.trim().slice(0, 110) });
    }
  }
}
console.log(`普查文件=${files.length} 支｜收集期重活命中=${rows.length} 处`);
for (const r of rows) console.log(`${r.file}:${String(r.line)}  ${r.text}`);
