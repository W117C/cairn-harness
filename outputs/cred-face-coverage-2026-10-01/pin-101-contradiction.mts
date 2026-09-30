/** 钉一处矛盾：`triage-flips.log` 在面里打到了 vitest 的双空格汇总行（Tests 后面两个空格那种），
 *  而 `context-strictness.mts` 仍把 `第 262 页` 的那条判卷计数记成「语境式找不到」。
 *  这一支只算这一条，把中间量全印出来，看是哪一步断了。
 *  （本文件自己不写任何严格式原文——它就在这个目录里，写了就等于替那条读数作证：规则 330 ⑶。） */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, CRED_NUMBER_RES } from "../../scripts/docs-check.ts";

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

const pages = credentialPages(readFileSync(join(ROOT, "PROGRESS.md"), "utf8"));
const p262 = pages.find((p) => p.key === "第 262 页" && p.dirs.length > 0)!;
console.log(`页=${p262.key}｜标题=${p262.title.slice(0, 40)}`);
console.log(`dirs=${p262.dirs.join("、")}`);
console.log(`numbers=${p262.numbers.join("、")}`);
const face = p262.dirs.map(readFace).filter((b): b is string => b !== null).join("\n");
console.log(`面字符数=${String(face.length)}`);
const ctx = new Set<string>();
for (const re of CRED_NUMBER_RES) {
  const found: string[] = [];
  for (const m of face.matchAll(new RegExp(re.source, "gu"))) { ctx.add(m[1]!); found.push(m[1]!); }
  console.log(`  严格式 ${re.source} ⇒ 面上命中 ${String(found.length)} 次：${found.slice(0, 8).join(",")}`);
}
console.log(`101 在语境集合里=${String(ctx.has("101"))}｜集合大小=${String(ctx.size)}`);
