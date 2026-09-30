/** 收紧前的存量测量（规则 235）：把 D-9 的回查端换成「剥色＋语境式」之后，已点名面里还有几条读数会翻红。
 *  三种判据并列印，差值就是这一格要买的东西：
 *    A＝现行（不剥色＋裸数位）  B＝只剥色（仍裸数位）  C＝剥色＋语境式（候选新判据） */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, sourcedReadings } from "../../scripts/docs-check.ts";
import { stripAnsi } from "../../scripts/lib/vitest-summary.ts";

/** 旧的回查形状（只按裸数位边界），第 266 页从生产端换掉了；这里留一份**局部**实现只为把 A/B 两臂跑出来。 */
const bareNumberHit = (face: string, num: string): boolean => new Set(face.split(/[^0-9.]+/u)).has(num);

const ROOT = process.argv[2];
const readFace = (dir: string): string | null => {
  const abs = join(ROOT, "outputs", dir);
  if (!existsSync(abs)) return null;
  try {
    return readdirSync(abs).filter((f) => !f.endsWith(".mjs"))
      .map((f) => { try { return readFileSync(join(abs, f), "utf8"); } catch { return ""; } })
      .join("\n");
  } catch { return null; }
};
const pages = credentialPages(readFileSync(join(ROOT, "PROGRESS.md"), "utf8")).filter((p) => p.dirs.length > 0 && p.numbers.length > 0);
let a = 0, b = 0, c = 0, total = 0;
const flipBtoC: string[] = [], flipAtoC: string[] = [], missedC: string[] = [];
for (const p of pages) {
  const raw = p.dirs.map(readFace).filter((x): x is string => x !== null).join("\n");
  if (raw === "") continue;
  const clean = stripAnsi(raw);
  const found = sourcedReadings(raw);   // C＝现行生产谓词自己（剥色＋语境式），不在探针里再抄一遍
  for (const n of p.numbers) {
    total++;
    const A = bareNumberHit(raw, n), B = bareNumberHit(clean, n), C = found.has(n);
    if (A) a++;
    if (B) b++;
    if (C) c++;
    if (A && !C) flipBtoC.push(`${p.key}|${n}`);
    if (!A && C) flipAtoC.push(`${p.key}|${n}`);
    if (!C) missedC.push(`${p.key}|${n}（A=${String(A)} B=${String(B)}）`);
  }
}
console.log(`已点名段=${String(pages.length)}｜读数合计=${String(total)} 条`);
console.log(`A 现行（不剥色＋裸数位）找到=${String(a)} 条｜B 只剥色=${String(b)} 条｜C 剥色＋语境式=${String(c)} 条`);
console.log(`换成 C 会翻红的=${String(flipBtoC.length)} 条：${flipBtoC.join("、") || "无"}`);
console.log(`换成 C 会新救回的（A 找不到而 C 找得到）=${String(flipAtoC.length)} 条：${flipAtoC.join("、") || "无"}`);
console.log(`C 之下仍找不到的=${String(missedC.length)} 条：${missedC.join("、") || "无"}`);
