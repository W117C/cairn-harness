/** 第二问：未点名那一档**按页**数是多少、最近几页是谁；以及「若我把这三页点名了目录，会不会当场咬出红」。
 *  这一步是收紧前的存量测量（规则 235）——帽要登记在现读上，而现读要含「新进入体检的存量红」。 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, hasNumber } from "../../scripts/docs-check.ts";

const ROOT = process.argv[2];
if (typeof ROOT !== "string" || ROOT === "") { console.error("用法：tsx simulate-naming.mts <仓根>"); process.exit(2); }

const readFace = (dir: string): string | null => {
  const abs = join(ROOT, "outputs", dir);
  if (!existsSync(abs)) return null;
  try {
    return readdirSync(abs).filter((f) => !f.endsWith(".mjs"))
      .map((f) => { try { return readFileSync(join(abs, f), "utf8"); } catch { return ""; } })
      .join("\n");
  } catch { return null; }
};

const pages = credentialPages(readFileSync(join(ROOT, "PROGRESS.md"), "utf8"));
const withReadings = pages.filter((p) => p.numbers.length > 0);
const unnamed = withReadings.filter((p) => p.dirs.length === 0);
console.log(`带读数的凭证页=${String(withReadings.length)}｜其中未点名页=${String(unnamed.length)} 页｜未点名读数合计=${String(unnamed.reduce((a, p) => a + p.numbers.length, 0))} 条`);
console.log(`未点名页（最后 6 页）：${unnamed.slice(-6).map((p) => `${p.key}(${String(p.numbers.length)}条)`).join("、")}`);

const namedPages = withReadings.filter((p) => p.dirs.length > 0);
console.log(`已点名页=${String(namedPages.length)}｜其中「点了名但目录读不到」的页=${String(namedPages.filter((p) => p.dirs.every((d) => readFace(d) === null)).length)}`);

/** 假设这三页各自点名它真正用过的目录 ⇒ 逐条数按门的同一个谓词回查。 */
const trial: [string, string][] = [
  ["第 262 页", "judge-timeout-2026-10-01"],
  ["第 263 页", "anchor-return-exits-2026-10-01"],
  ["第 264 页", "judge-timeout-2026-10-01"],
];
for (const [key, dir] of trial) {
  const p = pages.find((x) => x.key === key && x.dirs.length === 0 && x.numbers.length > 0);
  if (p === undefined) { console.log(`${key}：现读里没有这一档的未点名页（可能已被别的会话改过）`); continue; }
  const face = readFace(dir);
  if (face === null) { console.log(`${key} → ${dir}：目录读不到`); continue; }
  const miss = p.numbers.filter((n) => !hasNumber(face, n));
  console.log(`${key} → ${dir}：该页 ${String(p.numbers.length)} 条读数，点名后找不到原文的 ${String(miss.length)} 条${miss.length ? `（${miss.join("、")}）` : ""}`);
}
