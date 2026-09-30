/** 定位「顶包候选」第 11 格是谁（只读取数，不改盘）。跑法：
 *    node --import tsx outputs/prose-ceiling-2026-09-30/where.mts
 *  根要问 git（规则 244）：`scanRepo(root)` 拿到的 root 是 undefined 时它会一路 TypeError，
 *  第一版探针就是这么炸的——炸得响比读成 0 条好（规则 237/242 同一族）。 */
import { execFileSync } from "node:child_process";
import { ceilingBreaches, scanRepo } from "../../scripts/prose-needle-scan.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const r = scanRepo(root);
console.log(`顶包候选 ${String(r.committedMultiCopy)} 已提交 ＋ ${String(r.inFlightMultiCopy)} 在飞`);
for (const row of r.multiCopy) console.log(JSON.stringify(row));
console.log(`帽外读数：${JSON.stringify(ceilingBreaches(r))}`);
