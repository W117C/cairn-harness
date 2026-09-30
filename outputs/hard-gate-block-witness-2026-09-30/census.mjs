// 一次性普查（第 225 页 #40 的决策输入）：全仓 `tool_result` 落点，逐个看它带不带结构证人。
// 形状是**启发式**的（看事件对象字面量里有没有那几个字段名），所以它自己也要报盲区：
// 窗口只看 `type: "tool_result"` 之后 14 行 ⇒ 更长的字面量（例如条件展开拆成多行）会被漏读；
// 注释里的字段名会被误读成"带结构"。这一份只用来定"哪几处要改"，不用来报存量水位。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(n)) files.push(p);
  }
};
walk("src");

const WINDOW = 14;
let sites = 0;
const rows = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (!/type:\s*"tool_result"/.test(l)) return;
    sites++;
    const body = lines.slice(Math.max(0, i - 2), i + WINDOW).join("\n");
    const red = /ok:\s*false/.test(body) || /ok:\s*result\.ok/.test(body);
    const structural = /\bgate\b|\bblockedBy\b|\bexitCode\b|result\.ok/.test(body);
    rows.push(`${f}:${String(i + 1)}\t红或透传=${red ? "是" : "否"}\t带结构=${structural ? "是" : "否"}`);
  });
}
console.log(`tool_result 落点站点数 = ${String(sites)}（取料面：src/ 下全部 .ts，含注释误读的可能）`);
console.log(rows.join("\n"));
const bare = rows.filter((r) => r.includes("红或透传=是") && r.includes("带结构=否"));
console.log(`\n红/透传而不带结构 = ${String(bare.length)} 处`);
console.log(bare.join("\n"));
