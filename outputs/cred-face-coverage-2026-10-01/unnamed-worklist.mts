/** 任务 #11 的工作单：把「未点名取料目录」那 11 页逐页摊开——它认证哪个提交、那笔落在哪天、
 *  盘上有没有同期的 dated 目录、以及该页有几条读数等着进体检。只读，不改盘。
 *  用途：判每一页该走哪条路（① 工件在盘上 ⇒ 点名目录；② 当年只在 /tmp ⇒ 逐条登记不可回查）。 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { credentialPages } from "../../scripts/docs-check.ts";

const ROOT = process.argv[2];
/* 段体是生产类型 `CredPage` 没带出来的东西，这里按与 `credentialPages` **同样的段首形状**自己切一次：
   这不是"探针替被度量者重算判定"（规则 236 说的那种），判定仍然全部走 `credentialPages`。 */
const ledgerText = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
const lines = ledgerText.split("\n");
const heads = lines.map((l, i) => [l, i] as const).filter(([l]) => /^### /u.test(l));
const bodyOf = new Map<string, string>();
heads.forEach(([head, start], n) => {
  if (!head.includes("凭证")) return;
  const end = n + 1 < heads.length ? heads[n + 1]![1] : lines.length;
  const key = /第 \d+ 页/u.exec(head)?.[0] ?? head.slice(0, 16);
  bodyOf.set(key, (bodyOf.get(key) ?? "") + "\n" + lines.slice(start, end).join("\n"));
});

const pages = credentialPages(ledgerText);
const byKey = new Map<string, { nums: number, title: string }>();
for (const p of pages) {
  if (p.numbers.length === 0 || p.dirs.length > 0) continue;
  const cur = byKey.get(p.key);
  byKey.set(p.key, { nums: (cur?.nums ?? 0) + p.numbers.length, title: cur?.title ?? p.title });
}
const dirs = readdirSync(join(ROOT, "outputs")).filter((d) => /-\d{4}-\d{2}-\d{2}$/u.test(d));
console.log(`未点名页=${String(byKey.size)} 页｜盘上 dated 目录=${String(dirs.length)} 本`);
for (const [key, v] of byKey) {
  /* 段首常常不带提交号（凭证笔的标题里只写「第 N 页补 凭证」），所以从**段体**里取：
     第一支匹配限定在 7–40 位十六进制、且前面是反引号——标题里取不到不等于页没认证过（规则 259：标签不许大于取料面）。 */
  const body = bodyOf.get(key) ?? "";
  const shaMatch = /`([0-9a-f]{7,40})`/u.exec(body) ?? null;
  const sha = shaMatch?.[1] ?? "";
  let day = "取不到", commitSubject = "";
  if (sha !== "") {
    try {
      const out = execFileSync("git", ["-C", ROOT, "log", "-1", "--format=%ad %s", "--date=short", sha], { encoding: "utf8" });
      const m = /^(\d{4}-\d{2}-\d{2}) (.*)$/u.exec(out.trim());
      if (m !== null) { day = m[1]!; commitSubject = m[2]!.slice(0, 24); }
    } catch { day = "该 sha 不在本仓"; }
  }
  const sameDay = dirs.filter((d) => d.endsWith(day)).length;
  console.log(`${key}｜读数 ${String(v.nums)} 条｜认证提交=${sha === "" ? "段体里没取到" : sha.slice(0, 7)}｜提交日=${day}｜同日的 dated 目录=${String(sameDay)} 本｜提交标题=${commitSubject}`);
}
