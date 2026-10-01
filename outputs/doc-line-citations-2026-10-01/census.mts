/** 第 279 页普查：台账里那些「源码文件:行号」引用，今天到底追不追得到。
 *  与 D-10 判据**不同源**（这里自己切文本、自己数），所以两边的 74 撞上才算读数；同源就只是一个回声。 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const txt = readFileSync("PROGRESS.md", "utf8");
const uniq = [...new Set(txt.match(/[A-Za-z0-9_./-]+\.(?:ts|mts|mjs|js|json):[0-9]+/g) ?? [])];
const tracked = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8" }).trim().split("\n"));
const bare: string[] = [];
const dead: string[] = [];
const onDiskOnly: string[] = [];
const live: string[] = [];
for (const c of uniq) {
  const p = c.slice(0, c.lastIndexOf(":"));
  // 先问"追不追得到"，再问形状：根目录下的文件（`tsconfig.json:16`）本来就不需要目录，
  // 把"没有斜杠"直接判成追不到会多算一条（第一版就这么错了 1 条，被门的数逮住）。
  if (tracked.has(p)) { live.push(c); continue; }
  if (!p.includes("/")) { bare.push(c); continue; }
  if (existsSync(p)) onDiskOnly.push(c);
  else dead.push(c);
}
console.log(`去重候选 ${String(uniq.length)} 条｜HEAD 里存在 ${String(live.length)}｜追不到 ${String(bare.length + dead.length + onDiskOnly.length)}`);
console.log(`  拆成因：只写裸文件名 ${String(bare.length)}｜含路径但 HEAD 没有 ${String(dead.length)}｜只在盘上（未入库／隔壁在飞） ${String(onDiskOnly.length)}`);
console.log(`死路径名单：${dead.join(" ")}`);
console.log(`样本 裸名：${bare.slice(0, 6).join(" ")}`);
// 哨兵：这一条不许是 0，否则"没抽到"与"全都追得到"同形（规则 242）
console.log(`哨兵：候选数 > 0 ＝ ${String(uniq.length > 0)}｜样本里含 mutate-verify.mjs 的条数 ＝ ${String(uniq.filter((c) => c.includes("mutate-verify")).length)}`);
