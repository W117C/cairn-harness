/** 第 285 页那一串的自审：写在页面上的每个**计数**都从提交对象里重数一遍，不从记忆里取。
 *  ⚠️ 第一版是 shell 循环写的，被 zsh 的参数修饰符吃掉：`$sha:tests/…` 里的 `:t` 被当成「取尾」⇒
 *     路径变成 `ec004fcests/docs-check.test.ts`，读回 0 条。那一版留下的 `claims-audit-285.log` 一字不动留着
 *     （它现在同时是「一片 0 先怀疑取料面」这条规矩的现场证人，规则 237/322）。这一版走 `execFileSync`，
 *     参数是数组元素、没有第二次解析。 */
import { execFileSync } from "node:child_process";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const SHAS = ["ec004fc", "08e3ae8", "791c621", "b61cb41"];
const show = (sha: string, file: string): string => {
  try {
    return execFileSync("git", ["show", `${sha}:${file}`], { cwd: ROOT, encoding: "utf8" });
  } catch {
    return "";
  }
};
const count = (text: string, re: RegExp): number => (text.match(new RegExp(re.source, "gmu")) ?? []).length;

for (const sha of SHAS) {
  const mv = show(sha, "scripts/mutate-verify.mjs");
  const docsTest = show(sha, "tests/docs-check.test.ts");
  const ev = show(sha, "scripts/lib/evidence-typecheck.ts");
  // 第二版的三列读回 0（证人 `claims-audit-285-2.log`）：不是仓里没这些东西，是我三条正则都写歪了——
  // `DANGER_CODES` 那行是 `: readonly string[] = [`（我按 ` = [` 找）；条目形状是 `"路径": 2,`（我按 `]: 2` 找）；
  // 数条目那三条用了 `^ {2}"` 却没带 `m` 标志 ⇒ `^` 只认字符串开头。一片 0 先怀疑取料面（规则 237/322），这次又救回来一次。
  const decl = /export const DANGER_BASELINE: [^=]+ = \{([\s\S]*?)\n\}/u.exec(ev);
  const body = decl?.[1] ?? "";
  const codesLine = /export const DANGER_CODES:[^=]+ = \[([^\]]*)\]/u.exec(ev)?.[1] ?? "";
  const sum = [...body.matchAll(/": (\d+)/gu)].reduce((a, m) => a + Number(m[1]), 0);
  console.log([
    sha,
    `anchors=${String(count(mv, /^ {4}id: "/u))}`,
    `it_docs=${String(count(docsTest, /^ {2}it\("/u))}`,
    `base_files=${String([...body.matchAll(/^ {2}"/gmu)].length)}`,
    `base_sum=${String(sum)}`,
    `codes=${String([...codesLine.matchAll(/TS\d{4}/gu)].length)}`,
  ].join(" "));
}
