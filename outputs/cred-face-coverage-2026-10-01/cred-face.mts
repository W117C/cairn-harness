/** 一次性探针：D-9 的「凭证对账面」到底有没有查我最近几笔凭证页。
 *  复现门的 readFace 形状（非递归、只排除 .mjs），先自证三个分母能复现，再逐页打分类。
 *  **本文件里不写任何我打算在凭证页引用的读数原文**——探针落在这个目录里就进了门的取料面，
 *  写死数字等于让那条读数自己顶住自己（规则 328 自-hosted 同族，第 265 页现读）。 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, checkCredentialSources } from "../../scripts/docs-check.ts";

const ROOT = process.argv[2];
if (typeof ROOT !== "string" || ROOT === "") { console.error("用法：tsx cred-face.mts <仓根>"); process.exit(2); }

const readFace = (dir: string): string | null => {
  const abs = join(ROOT, "outputs", dir);
  if (!existsSync(abs)) return null;
  try {
    return readdirSync(abs).filter((f) => !f.endsWith(".mjs"))
      .map((f) => { try { return readFileSync(join(abs, f), "utf8"); } catch { return ""; } })
      .join("\n");
  } catch { return null; }
};

const text = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
const pages = credentialPages(text);
console.log(`凭证页数（标题含「凭证」）=${String(pages.length)}｜点名叫目录的页=${String(pages.filter((p) => p.dirs.length > 0).length)}`);

const res = checkCredentialSources(pages, readFace);
console.log(`复现门的三个分母：可比对=${String(res.checked)}｜未点名=${String(res.unnamed)}｜取不到=${String(res.unmatched)}｜红=${String(res.findings.length)}`);

const targets = ["第 260 页", "第 262 页", "第 263 页", "第 264 页", "第 257 页"];
for (const p of pages) {
  if (!targets.some((t) => p.key.includes(t))) continue;
  const blobs = p.dirs.map(readFace);
  const face = blobs.filter((b): b is string => b !== null).join("\n");
  const kind = p.dirs.length === 0 ? "未点名" : blobs.every((b) => b === null) ? "取不到" : "可比对";
  console.log(`\n[${kind}] ${p.key}｜numbers(${String(p.numbers.length)})=${p.numbers.join(",")}`);
  console.log(`   dirs(${String(p.dirs.length)})=${p.dirs.join(",")}`);
  if (kind === "可比对") console.log(`   取料面字符数=${String(face.length)}｜每条数在面里寻到原文=${p.numbers.map((n) => `${n}:${String(face.includes(n))}`).join(" ")}`);
}
