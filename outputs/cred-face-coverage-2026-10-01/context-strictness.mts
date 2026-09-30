/** 第三问：D-9 的「找到原文」若改成**语境式**（面里必须出现 `Test Files N passed`／`real N`／`针脚体检：N 条` 这类
 *  严格式的整句形状），存量里有几条读数会从「找到」翻成「找不到」。
 *  现在的判定只按裸数位边界 ⇒ 面里散文提到 `8`／`6` 就能替一条读数顶住——抽取端要求语境、回查端不要求，这个不对称就是本探针要量的东西。 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, CRED_NUMBER_RES } from "../../scripts/docs-check.ts";

/** 旧的回查形状（只按裸数位边界）。第 266 页把它从生产端换掉了，探针留一份**局部**实现只为复现当时的 A/B 对照：
 *  生产端不再调用它，所以这里重算不算"抄被度量者"（规则 236 说的是反过来那种情形）。
 *  写法：把面上所有"数字串"整段切出来做精确成员比对——等价于前后不许粘数字或点，避免正则转义抄错。 */
const bareNumberHit = (face: string, num: string): boolean => new Set(face.split(/[^0-9.]+/u)).has(num);

const ROOT = process.argv[2];
if (typeof ROOT !== "string" || ROOT === "") { console.error("用法：tsx context-strictness.mts <仓根>"); process.exit(2); }

const readFace = (dir: string): string | null => {
  const abs = join(ROOT, "outputs", dir);
  if (!existsSync(abs)) return null;
  try {
    return readdirSync(abs).filter((f) => !f.endsWith(".mjs"))
      .map((f) => { try { return readFileSync(join(abs, f), "utf8"); } catch { return ""; } })
      .join("\n");
  } catch { return null; }
};

/** 语境式：把面上所有严格式命中的那一份数收集起来，看目标数在不在里面（不是"数在不在面里"）。 */
function contextNumbers(face: string): Set<string> {
  const out = new Set<string>();
  for (const re of CRED_NUMBER_RES) for (const m of face.matchAll(new RegExp(re.source, "gu"))) out.add(m[1]!);
  return out;
}

const pages = credentialPages(readFileSync(join(ROOT, "PROGRESS.md"), "utf8")).filter((p) => p.dirs.length > 0 && p.numbers.length > 0);
let bare = 0, strict = 0, flip = 0;
const flips: string[] = [];
for (const p of pages) {
  const blobs = p.dirs.map(readFace).filter((b): b is string => b !== null);
  if (blobs.length === 0) continue;
  const face = blobs.join("\n");
  const ctx = contextNumbers(face);
  for (const n of p.numbers) {
    const b = bareNumberHit(face, n), s = ctx.has(n);
    if (b) bare++;
    if (s) strict++;
    if (b && !s) { flip++; flips.push(`${p.key}|${n}`); }
  }
}
console.log(`已点名页=${String(pages.length)} 段`);
console.log(`裸数位边界判定的「找到」=${String(bare)} 条｜语境式判定的「找到」=${String(strict)} 条｜会从找到翻成找不到=${String(flip)} 条`);
console.log(`翻转名单（前 24 条）：${flips.slice(0, 24).join("、")}${flips.length > 24 ? `…共 ${String(flips.length)} 条` : ""}`);
