/** 拆分「可比对 124 → 146」这一格里两笔动作各自的贡献：点名三页 vs 严格式认两个空格。
 *  做法：对同一份台账分别用「旧一空格正则」与「现行正则」抽数，只比抽取面的差异（不碰盘、不碰代码）。 */
import { readFileSync } from "node:fs";
import { CRED_NUMBER_RES } from "../../scripts/docs-check.ts";

const OLD_RES = [
  /Test Files (\d+) passed/u,
  /Tests (\d+) passed/u,
  /\breal ([0-9]+(?:\.[0-9]+)?)/u,
  /本次耗时 ([0-9]+(?:\.[0-9]+)?)s/u,
  /针脚体检：(\d+) 条/u,
  /跑了 (\d+)\/\d+ 条/u,
];
const extract = (text: string, res: readonly RegExp[]): Set<string> => {
  const s = new Set<string>();
  for (const re of res) for (const m of text.matchAll(new RegExp(re.source, "gu"))) s.add(m[1]!);
  return s;
};

const ROOT = process.argv[2];
const lines = readFileSync(`${ROOT}/PROGRESS.md`, "utf8").split("\n");
const heads = lines.map((l, i) => [l, i] as const).filter(([l]) => /^### /u.test(l));
let oldTotal = 0, newTotal = 0;
const gainedByPage: string[] = [];
for (let n = 0; n < heads.length; n++) {
  const [head, start] = heads[n]!;
  if (!head.includes("凭证")) continue;
  const end = n + 1 < heads.length ? heads[n + 1]![1] : lines.length;
  const body = lines.slice(start, end).join("\n");
  const dirs = [...new Set([...body.matchAll(/outputs\/([A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2})/gu)].map((m) => m[1]!))];
  if (dirs.length === 0) continue;
  const o = extract(body, OLD_RES), nw = extract(body, CRED_NUMBER_RES);
  oldTotal += o.size; newTotal += nw.size;
  const extra = [...nw].filter((x) => !o.has(x));
  if (extra.length > 0) gainedByPage.push(`${(/第 \d+ 页/u.exec(head)?.[0] ?? head.slice(0, 12))}+${extra.join("/")}`);
}
console.log(`已点名页的读数合计：旧一空格形状抽出 ${String(oldTotal)} 条｜现行形状抽出 ${String(newTotal)} 条｜仅由空格形状多出 ${String(newTotal - oldTotal)} 条`);
console.log(`空格形状带来的增量按页：${gainedByPage.join("、") || "无"}`);
