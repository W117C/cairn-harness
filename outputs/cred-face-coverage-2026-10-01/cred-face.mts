/** 一次性探针：D-9 的「凭证对账面」到底有没有查我最近几笔凭证页。
 *  复现门的 readFace 形状（非递归、只排除 .mjs），先自证三个分母能复现，再逐页打分类。
 *  **本文件里不写任何我打算在凭证页引用的读数原文**——探针落在这个目录里就进了门的取料面，
 *  写死数字等于让那条读数自己顶住自己（规则 328 自-hosted 同族，第 265 页现读）。 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, checkCredentialSources, credFaceFiles, sourcedReadings, UNSOURCED_READINGS, UNSOURCED_CRED_PAGES, CRED_UNNAMED_PAGE_CAP, CRED_WEAK_WITNESS_CAP } from "../../scripts/docs-check.ts";

const ROOT = process.argv[2];
if (typeof ROOT !== "string" || ROOT === "") { console.error("用法：tsx cred-face.mts <仓根>"); process.exit(2); }

/* 第 284 页：这里从前**自己抄了一份读面**（返回拼好的整块字符串），第 269 页把 D-9 的面改成按文件之后
 *  这份副本静默烂掉——没人重跑，就没人知道它已经不匹配门的形状（现跑报 `x.list.map is not a function`）。
 *  现在取料面由门自己导出（`credFaceFiles`），探针与生产端同一份构造器：形状再漂就是编译期错误，而不是某次没人跑的崩溃。 */
const readFace = (dir: string) => credFaceFiles(ROOT, dir);

const text = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
const pages = credentialPages(text);
console.log(`凭证页数（标题含「凭证」）=${String(pages.length)}｜点名叫目录的页=${String(pages.filter((p) => p.dirs.length > 0).length)}`);

const res = checkCredentialSources(pages, readFace, UNSOURCED_READINGS, CRED_UNNAMED_PAGE_CAP, CRED_WEAK_WITNESS_CAP, UNSOURCED_CRED_PAGES);
console.log(`复现门的三个分母：可比对=${String(res.checked)}｜未点名=${String(res.unnamed)}｜取不到=${String(res.unmatched)}｜红=${String(res.findings.length)}`);

const targets = ["第 260 页", "第 262 页", "第 263 页", "第 264 页", "第 257 页"];
for (const p of pages) {
  if (!targets.some((t) => p.key.includes(t))) continue;
  /* 第 284 页：这一段从前假设面是"一整块字符串"，那是它抄门的老形状留下的假设。
     现在按文件拿，判"这条数在不在面上"直接叫门自己那个谓词 `sourcedReadings`——
     探针再抄一份 `face.includes(n)` 就是第三份匹配逻辑（它比门的谓词宽，会把散文里提到的数字也算成证人）。 */
  const files = p.dirs.flatMap((d) => readFace(d) ?? []);
  const blobs = p.dirs.map(readFace);
  const kind = p.dirs.length === 0 ? "未点名" : blobs.every((b) => b === null) ? "取不到" : "可比对";
  const perFile = files.map((f) => sourcedReadings(f.text));
  const found = new Set<string>(perFile.flatMap((s) => [...s]));
  console.log(`\n[${kind}] ${p.key}｜numbers(${String(p.numbers.length)})=${p.numbers.join(",")}`);
  console.log(`   dirs(${String(p.dirs.length)})=${p.dirs.join(",")}｜面上文件数=${String(files.length)}`);
  if (kind === "可比对") {
    console.log(`   取料面字符数=${String(files.reduce((a, f) => a + f.text.length, 0))}｜每条数有几个文件作证=${p.numbers.map((n) => `${n}:${String(perFile.filter((s) => s.has(n)).length)}`).join(" ")}`);
  }
}
